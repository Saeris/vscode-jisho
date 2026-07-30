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
import { connect } from "@tursodatabase/database";
import type { TagDto } from "../shared/messages";

type Db = Awaited<ReturnType<typeof connect>>;
type Statement = Awaited<ReturnType<Db["prepare"]>>;

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
   *  * A writable connection is EXCLUSIVE across processes, so two test files that each opened the
   *    dictionary collided ("File is locked by another process"). Read-only connections coexist,
   *    which is what lets DB-backed specs run in parallel workers at all.
   */
  static async open(path: string): Promise<SqliteStore> {
    return new SqliteStore(await connect(path, { readonly: true }));
  }

  /**
   * Prepared statements, cached by SQL text.
   *
   * `prepare()` re-parses and re-plans on every call — measured at 0.0158ms against 0.0039ms for a
   * reused statement. That 4x is paid by every read, and result hydration pays it four times per
   * result, so it dominated search latency at scale.
   *
   * Keyed on SQL text, so a query built from a variable-length parameter list gets one entry per
   * distinct length. Those lists are short by design (see CONVENTIONS.md on why `IN (…)` is banned
   * on indexed columns), which is what keeps this bounded.
   */
  #stmts = new Map<string, Promise<Statement>>();

  async #prepare(sql: string): Promise<Statement> {
    const cached = this.#stmts.get(sql);
    if (cached) return cached;
    // Cache the PROMISE, not the resolved statement: concurrent callers racing the same first
    // prepare would otherwise each start their own.
    const pending = this.#db.prepare(sql);
    this.#stmts.set(sql, pending);
    return pending;
  }

  // Turso's `.get()`/`.all()` return `any`; funnelling every read through these two methods confines
  // that unavoidable boundary to one audited place and gives callers precise row types without
  // scattered `as` assertions.
  async all<T>(sql: string, ...params: Array<string | number>): Promise<T[]> {
    const stmt = await this.#prepare(sql);
    const rows: T[] = await stmt.all(...params);
    return rows;
  }

  async get<T>(
    sql: string,
    ...params: Array<string | number>
  ): Promise<T | undefined> {
    const stmt = await this.#prepare(sql);
    const row: T | undefined = await stmt.get(...params);
    return row;
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

  async close(): Promise<void> {
    await this.#db.close();
  }
}
