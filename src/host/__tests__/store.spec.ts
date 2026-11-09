import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { SqliteStore } from "../store";

/**
 * The connection settings `SqliteStore.open` applies, checked against a throwaway database so this
 * runs everywhere — the real dictionary is not needed to see what a connection was given.
 */
describe("sqliteStore.open", () => {
  let dir: string;
  let path: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "jisho-store-"));
    path = join(dir, "probe.db");
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE t (x INTEGER)");
    db.close();
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives the connection a 64 MB page cache", async () => {
    // WHY: the dictionary's slow queries were I/O, not JavaScript — 4% of `refineCounts` was JS and
    // most of the rest re-read pages through syscalls because SQLite's default ~2 MB cache cannot hold
    // what one query touches. The larger cache measured ~3x on slow searches and kanji detail and up
    // to 1.5x on refineCounts; losing it silently would bring all of that back.
    using store = await SqliteStore.open(path);
    const row = await store.get<{ cache_size: number }>("PRAGMA cache_size");
    // Negative means KiB rather than pages.
    expect(row?.cache_size).toBe(-64 * 1024);
  });

  it("stays read-only", async () => {
    // WHY: read-only is load-bearing (CONVENTIONS.md) — it keeps -wal/-shm files out of the user's
    // storage and lets parallel test workers and a data rebuild share the file. A pragma that needed
    // write access would be the kind of change that quietly reverts it.
    using store = await SqliteStore.open(path);
    await expect(store.all("INSERT INTO t VALUES (1)")).rejects.toThrow(
      /readonly/iu
    );
  });
});
