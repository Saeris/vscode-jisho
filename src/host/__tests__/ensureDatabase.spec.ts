import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory stand-in for the pieces of `vscode.workspace.fs` that ensureDatabase uses.
// Keyed by the Uri's fsPath. `copy` records how many times it ran so we can assert re-copy behavior.
const files = new Map<string, string>();
let copyCount = 0;
let linkCount = 0;
/** Set to make the mocked `link()` fail, exercising the copy fallback (cross-volume, no link support). */
let linkFails = false;
/**
 * Set to make BOTH `link()` and `copy()` fail with a Windows busy error.
 *
 * The real condition: an open file cannot be unlinked or overwritten on Windows, so a second
 * window or this extension's own previous activation holding the DB makes a routine re-link throw.
 */
let writesFail = false;

// `node:fs/promises` MUST be mocked too, not just `vscode.workspace.fs`: dev provisioning links
// rather than copies now, and an unmocked `link()` would hit the real filesystem with these fake
// paths, fail, and silently fall through to the copy — so the tests would pass while never
// exercising the path that actually runs.
vi.mock("node:fs/promises", () => ({
  link: async (from: string, to: string) => {
    if (writesFail)
      throw new Error(
        "EBUSY: resource busy or locked, unlink '/storage/jisho.db'"
      );
    if (linkFails) throw new Error("EXDEV: cross-device link not permitted");
    linkCount += 1;
    files.set(to, files.get(from) ?? "");
  },
  unlink: async (path: string) => {
    // Windows refuses to unlink a file another process holds open, which is the whole reported
    // failure: the destination SURVIVES and the refresh cannot proceed.
    if (writesFail)
      throw new Error(`EBUSY: resource busy or locked, unlink '${path}'`);
    if (!files.has(path)) throw new Error("ENOENT");
    files.delete(path);
  }
}));

const uri = (fsPath: string) => ({
  fsPath,
  toString: () => fsPath
});

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) =>
      uri([base.fsPath, ...parts].join("/"))
  },
  ProgressLocation: { Notification: 15 },
  window: {
    // `ensureDatabase` logs when it degrades to an existing database rather than failing, so the
    // channel has to exist. Inert: what it SAYS is not what these tests are about.
    createOutputChannel: () => ({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      appendLine: () => undefined
    }),
    // Run the task immediately with an inert progress reporter.
    withProgress: async (
      _opts: unknown,
      task: (progress: { report: () => void }) => Promise<unknown>
    ) => task({ report: () => undefined })
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
        if (writesFail)
          throw new Error(
            "EBUSY: resource busy or locked, unlink '/storage/jisho.db'"
          );
        copyCount += 1;
        files.set(dst.fsPath, files.get(src.fsPath) ?? "");
      }
    }
  }
}));

// The download module is exercised by its own spec; here it just marks the file "downloaded".
const downloadMock = vi.fn<(destPath: string) => Promise<string>>(
  async (destPath) => {
    files.set(destPath, "downloaded-db");
    return "full v1";
  }
);
vi.mock("../download", () => ({
  downloadDatabase: async (destPath: string) => downloadMock(destPath)
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
    linkCount = 0;
    linkFails = false;
    writesFail = false;
    downloadMock.mockClear();
    // A bundled DB + version always exists (the dev backend).
    files.set(BUNDLED_DB, "db-v1");
    files.set(BUNDLED_VERSION, "version-1");
  });

  it("links the bundled DB into global storage on first run", async () => {
    // WHY: on a fresh install there is no cached DB; it must be materialized before any query.
    // A LINK rather than a copy — the copy of a ~450MB file measured 7.3s of every fresh-profile
    // activation, which was the largest single cost before the first search.
    const path = await ensureDatabase(context);
    expect(path).toBe(CACHED_DB);
    expect(linkCount).toBe(1);
    expect(copyCount).toBe(0);
    expect(files.get(CACHED_DB)).toBe("db-v1");
  });

  it("falls back to copying when linking is not possible", async () => {
    // WHY: hard links cannot cross volumes, so a globalStorage on a different drive from the repo
    // (or a filesystem without link support) MUST still provision. The user-visible outcome has to
    // be identical — only the mechanism differs.
    linkFails = true;
    const path = await ensureDatabase(context);
    expect(path).toBe(CACHED_DB);
    expect(copyCount).toBe(1);
    expect(files.get(CACHED_DB)).toBe("db-v1");
  });

  it("does not re-provision when the cached version matches", async () => {
    // WHY: re-materializing a large DB on every activation would be slow and pointless; the version
    // guard must recognize an up-to-date cache.
    await ensureDatabase(context);
    const after = linkCount + copyCount;
    await ensureDatabase(context);
    expect(linkCount + copyCount).toBe(after); // no additional work
  });

  it("re-links when the bundled DB is a newer version", async () => {
    // WHY: this is the exact bug we hit — a rebuilt DB must propagate instead of a stale copy being
    // cached forever. A changed version stamp forces a refresh.
    //
    // Doubly load-bearing now that this is a LINK: a rebuild renames a NEW file over
    // `assets/jisho.db`, so the existing link still resolves to the OLD inode. Nothing but this
    // version comparison would notice, and the extension would serve the previous dictionary.
    await ensureDatabase(context);
    expect(linkCount).toBe(1);

    // Simulate a rebuild: bundled DB + version change.
    files.set(BUNDLED_DB, "db-v2");
    files.set(BUNDLED_VERSION, "version-2");

    await ensureDatabase(context);
    expect(linkCount).toBe(2);
    expect(files.get(CACHED_DB)).toBe("db-v2");
  });

  it("serves the existing DB when a refresh is blocked by another process", async () => {
    // WHY (reported): on Windows an open file cannot be unlinked, so a second VS Code window — or
    // this extension's own previous activation — turns a routine re-link into EBUSY. That threw out
    // of ensureDatabase, rejected the dictionary, and every vocabulary hover went silent while
    // grammar notes kept working, because those read in-memory tables and never touch the database.
    // Half-working hovers with no error is the worst possible symptom.
    files.set(CACHED_DB, "db-v0");
    files.set("/storage/jisho.db.version", "version-0"); // stale, so a refresh is attempted
    writesFail = true;

    const path = await ensureDatabase(context);

    // A stale dictionary beats no dictionary. The caller gets a usable path either way.
    expect(path).toBe(CACHED_DB);
    expect(files.get(CACHED_DB)).toBe("db-v0");
  });

  it("still throws when a refresh is blocked and there is NO database", async () => {
    // WHY: the other half. Degrading to "the existing copy" is only correct when one exists —
    // swallowing the error with nothing on disk would hand back a path to a file that is not there,
    // and the failure would resurface later as an unexplained open error.
    writesFail = true;

    await expect(ensureDatabase(context)).rejects.toThrow(/EBUSY/u);
  });

  it("downloads the dictionary when no bundled DB and no cached copy exist", async () => {
    // WHY: this is the installed-user first run — no assets/ folder ships in the .vsix, so the
    // download backend must provision the database.
    files.delete(BUNDLED_DB);
    files.delete(BUNDLED_VERSION);
    const path = await ensureDatabase(context);
    expect(path).toBe(CACHED_DB);
    expect(downloadMock).toHaveBeenCalledWith(CACHED_DB);
    expect(files.get(CACHED_DB)).toBe("downloaded-db");
  });

  it("does not re-download when a downloaded copy already exists", async () => {
    // WHY: offline-first — after the first download, activation must never require network.
    files.delete(BUNDLED_DB);
    files.delete(BUNDLED_VERSION);
    await ensureDatabase(context);
    downloadMock.mockClear();
    await ensureDatabase(context);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
