import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory stand-in for the pieces of `vscode.workspace.fs` that ensureDatabase uses.
// Keyed by the Uri's fsPath. `copy` records how many times it ran so we can assert re-copy behavior.
const files = new Map<string, string>();
let copyCount = 0;

const uri = (fsPath: string) => ({
  fsPath,
  toString: () => fsPath
});

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) =>
      uri([base.fsPath, ...parts].join("/"))
  },
  workspace: {
    fs: {
      createDirectory: async () => undefined,
      stat: async (u: { fsPath: string }) => {
        if (!files.has(u.fsPath)) throw new Error("ENOENT");
        return { type: 1 };
      },
      readFile: async (u: { fsPath: string }) => {
        const v = files.get(u.fsPath);
        if (v === undefined) throw new Error("ENOENT");
        return Buffer.from(v, "utf8");
      },
      writeFile: async (u: { fsPath: string }, content: Uint8Array) => {
        files.set(u.fsPath, Buffer.from(content).toString("utf8"));
      },
      copy: async (src: { fsPath: string }, dst: { fsPath: string }) => {
        copyCount += 1;
        files.set(dst.fsPath, files.get(src.fsPath) ?? "");
      }
    }
  }
}));

const { ensureDatabase } = await import("../ensureDatabase");

const context = {
  globalStorageUri: uri("/storage"),
  extensionUri: uri("/ext")
} as never;

const BUNDLED_DB = "/ext/assets/jisho.db";
const BUNDLED_VERSION = "/ext/assets/jisho.db.version";
const CACHED_DB = "/storage/jisho.db";

describe("ensureDatabase", () => {
  beforeEach(() => {
    files.clear();
    copyCount = 0;
    // A bundled DB + version always exists (the dev backend).
    files.set(BUNDLED_DB, "db-v1");
    files.set(BUNDLED_VERSION, "version-1");
  });

  it("copies the bundled DB into global storage on first run", async () => {
    // WHY: on a fresh install there is no cached DB; it must be materialized before any query.
    const path = await ensureDatabase(context);
    expect(path).toBe(CACHED_DB);
    expect(copyCount).toBe(1);
    expect(files.get(CACHED_DB)).toBe("db-v1");
  });

  it("does not re-copy when the cached version matches", async () => {
    // WHY: re-copying a large DB on every activation would be slow and pointless; the version guard
    // must recognize an up-to-date cache.
    await ensureDatabase(context);
    const copiesAfterFirst = copyCount;
    await ensureDatabase(context);
    expect(copyCount).toBe(copiesAfterFirst); // no additional copy
  });

  it("re-copies when the bundled DB is a newer version", async () => {
    // WHY: this is the exact bug we hit — a rebuilt DB must propagate instead of a stale copy being
    // cached forever. A changed version stamp forces a refresh.
    await ensureDatabase(context);
    expect(copyCount).toBe(1);

    // Simulate a rebuild: bundled DB + version change.
    files.set(BUNDLED_DB, "db-v2");
    files.set(BUNDLED_VERSION, "version-2");

    await ensureDatabase(context);
    expect(copyCount).toBe(2);
    expect(files.get(CACHED_DB)).toBe("db-v2");
  });

  it("throws a helpful error when no bundled DB and no cached copy exist", async () => {
    // WHY: a missing database is a setup problem; the message must tell the developer how to fix it
    // rather than failing with an opaque open error later.
    files.delete(BUNDLED_DB);
    files.delete(BUNDLED_VERSION);
    await expect(ensureDatabase(context)).rejects.toThrow(/build:data/);
  });
});
