/**
 * The bits every SQLite-backed dictionary needs: a connection, a statement cache, typed reads, and
 * the tag-code dictionary.
 *
 * `Dictionary` and `NamesDictionary` had all of this twice, byte-for-byte, and the copies drifted:
 * the statement cache that made queries ~4x cheaper was added to one and not the other, so the names
 * dictionary silently kept re-preparing every statement. Nothing structural was keeping them in
 * step, which is the actual defect — the duplication was just how it showed up.
 *
 * Composed, not inherited: each dictionary owns a store and keeps its own schema-specific queries,
 * so neither inherits a query surface it has no rows for.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { TagDto } from "../shared/messages";

type Db = DatabaseSync;

/**
 * SQLite's page cache, per connection: 64 MB, against a default of about 2 MB.
 *
 * The dictionary is 470 MB, and its slow queries were not slow JavaScript. A tick profile of
 * `refineCounts` put 4% in JS and 56% in `ntdll.dll` — the same pages read back through syscalls
 * because a 2 MB cache cannot hold what one query touches. Measured with `bench/dictionary.bench.ts`
 * (mean ms, default → 16 / 32 / 64 MB):
 *
 *   search の          16.1 →  4.9 /  5.0 /  4.9
 *   search 日          28.1 → 10.3 / 10.6 / 10.5
 *   getKanji 日        16.9 →  4.3 /  4.6 /  4.6
 *   browse #jlpt-n5    42.5 → 42.6 / 20.3 / 19.2
 *   browse #noun        239 →  250 /  244 /  211
 *   refineCounts #noun 1975 → 1542 / 1411 / 1315
 *
 * Searches saturate at 16 MB; browsing needs 32; the heaviest cases — the ones that block every
 * extension longest — keep improving to 64. The memory is lazy: a typical session's lookups grew the
 * process by 4 MB at any cap, and the cap is approached only by the heaviest scans. Paths that were
 * already sub-millisecond are unchanged.
 */
const PAGE_CACHE_KIB = 64 * 1024;

/**
 * Prepared statements kept per connection. Far more than the queries a session repeats — the
 * fixed queries are a few dozen — so only one-off `IN (…)` lengths are ever dropped.
 */
export const STATEMENT_CACHE_SIZE = 256;
type Statement = StatementSync;

/**
 * Holds a store that is only *provisionally* owned — disposed on scope exit unless `release()` is
 * called first.
 *
 * This is the "transfer ownership on success" shape that a bare `using` cannot express: a factory
 * must close the handle if it fails partway, but must NOT close it once it returns the object that
 * now owns it. Writing that as try/catch works (and did), but the correctness lives in remembering
 * to write the catch — which is exactly what was missed in both dictionary factories.
 */
export class DisposableStore {
  #store: SqliteStore | undefined;
  readonly store: SqliteStore;

  constructor(store: SqliteStore) {
    this.store = store;
    this.#store = store;
  }

  /** Give up ownership: the caller is now responsible for closing. */
  release(): void {
    this.#store = undefined;
  }

  [Symbol.dispose](): void {
    this.#store?.[Symbol.dispose]();
  }
}

export class SqliteStore {
  #db: Db;
  #tags = new Map<string, string>();

  private constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Open a dictionary for querying.
   *
   * READ-ONLY, deliberately. Nothing in this layer writes — grep the query modules for INSERT,
   * UPDATE, DELETE, CREATE or DROP and you get nothing — so asking for write access was asking for
   * permission we do not use. Two consequences follow:
   *
   *  * It stops the extension creating `-wal`/`-shm` files beside the database it downloaded into the
   *    user's global storage, for a file it only ever reads.
   *  * Read-only connections coexist across processes, which is what lets DB-backed specs run in
   *    parallel workers at all — and what lets a rebuild proceed while the extension host has the
   *    old file open (see the staging path in `scripts/build-data.ts`).
   */
  // Async for the same reason as the reads below: callers already await it, and keeping the shape
  // is what let the dictionaries move into a worker thread (dictionaryWorker.ts) unchanged.
  // oxlint-disable-next-line typescript/require-await
  static async open(path: string): Promise<SqliteStore> {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec(`PRAGMA cache_size = -${PAGE_CACHE_KIB}`);
    return new SqliteStore(db);
  }

  /**
   * Prepared statements, cached by SQL text.
   *
   * `prepare()` re-parses and re-plans on every call — measured at 0.0158ms against 0.0039ms for a
   * reused statement. That 4x is paid by every read, and result hydration pays it four times per
   * result, so it dominated search latency at scale.
   *
   * Keyed on SQL text, so a query built from a variable-length parameter list gets one entry per
   * distinct length — and those lists are long and varied: CONVENTIONS.md prefers `IN (…)` for id
   * batches, and `refineCounts` alone builds lists of up to 900. So the cache is capped, least
   * recently used dropped first (audit I-4). It used to claim those lists were "short by design",
   * citing a rule CONVENTIONS.md had since reversed.
   */
  #stmts = new Map<string, Statement>();

  /** Statements currently cached. For the test that holds the cap. */
  get cachedStatements(): number {
    return this.#stmts.size;
  }

  #prepare(sql: string): Statement {
    const cached = this.#stmts.get(sql);
    if (cached) {
      // Re-inserted, so the Map's order stays least-recently-used first.
      this.#stmts.delete(sql);
      this.#stmts.set(sql, cached);
      return cached;
    }
    const stmt = this.#db.prepare(sql);
    this.#stmts.set(sql, stmt);
    if (this.#stmts.size > STATEMENT_CACHE_SIZE) {
      const oldest = this.#stmts.keys().next();
      if (oldest.done !== true) this.#stmts.delete(oldest.value);
    }
    return stmt;
  }

  /*
   * `node:sqlite` is SYNCHRONOUS, but these stay async.
   *
   * Every query module and both dictionaries await them, and the host's message dispatch is async
   * regardless — so making them sync would be a large mechanical edit that buys nothing. Keeping the
   * promise-returning shape is also what let the reads move into a worker thread
   * (dictionaryWorker.ts) without touching a single caller.
   *
   * `.get()`/`.all()` return loosely-typed rows; funnelling every read through these two methods
   * confines that boundary to one audited place and gives callers precise row types without
   * scattered `as` assertions.
   */
  // oxlint-disable-next-line typescript/require-await
  async all<T>(sql: string, ...params: Array<string | number>): Promise<T[]> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return this.#prepare(sql).all(...params) as T[];
  }

  // oxlint-disable-next-line typescript/require-await
  async get<T>(
    sql: string,
    ...params: Array<string | number>
  ): Promise<T | undefined> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return this.#prepare(sql).get(...params) as T | undefined;
  }

  /**
   * Load a tag-code → description table. The parameter is a closed union rather than a string
   * because it is interpolated into SQL — a table name cannot be bound as a parameter, so the type
   * is what keeps this from being an injection point.
   */
  async loadTags(table: "tags" | "name_tags"): Promise<void> {
    const rows = await this.all<{ tag: string; description: string }>(
      `SELECT tag, description FROM ${table}`
    );
    for (const { tag, description } of rows) this.#tags.set(tag, description);
  }

  /** A tag code with its human description, falling back to the code when it isn't in the table. */
  tag(code: string): TagDto {
    return { code, description: this.#tags.get(code) ?? code };
  }

  // oxlint-disable-next-line typescript/require-await
  async close(): Promise<void> {
    this.#db.close();
  }

  /**
   * Explicit Resource Management, so `using store = ...` closes the handle on scope exit.
   *
   * This exists because forgetting to close is not a leak you notice: on Linux the handle is
   * reclaimed at exit and nothing looks wrong, while on Windows it makes the file undeletable —
   * so the same omission is invisible in CI and breaks a dictionary UPDATE for a real user. Two
   * such leaks were already found by hand (`Dictionary.open`/`NamesDictionary.open` both rejected
   * without closing the store they had just opened).
   *
   * Synchronous, matching `DatabaseSync[Symbol.dispose]`, which Node implements natively — so this
   * needs no polyfill on the extension host's Node 24.
   */
  [Symbol.dispose](): void {
    this.#db.close();
  }
}
