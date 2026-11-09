import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Classifier } from "../../shared/classifiers";
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from "../../shared/schema";
import { SchemaVersionError, type Dictionary } from "../db";
import { openRemote } from "../remote";

/**
 * The dictionary worker, run for real: the built `dist/dictionaryWorker.cjs`, against a throwaway
 * database. A worker is a separate script, so this is the only way to see what crosses the thread
 * boundary — errors included.
 *
 * Skipped when the host is not built, like `packaging.spec.ts`; CI builds it before testing.
 */
const WORKER = join(process.cwd(), "dist", "dictionaryWorker.cjs");
const DB_PATH = join(process.cwd(), "assets", "jisho.db");

let dir: string;

/** The smallest database `Dictionary.open` accepts: a schema version and a tags table. */
const database = (name: string, schemaVersion: number): string => {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("CREATE TABLE tags (tag TEXT PRIMARY KEY, description TEXT)");
  db.prepare("INSERT INTO meta VALUES (?, ?)").run(
    SCHEMA_VERSION_KEY,
    String(schemaVersion)
  );
  db.close();
  return path;
};

describe("dictionaries in a worker thread", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "jisho-remote-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe.skipIf(!existsSync(WORKER))("the dictionary worker", () => {
    it("answers from the worker as the dictionary would", async () => {
      // WHY: callers keep calling `dict.getMeta()` as before; the stand-in must return the same data.
      const remote = await openRemote<Dictionary>(
        WORKER,
        "words",
        database("answers.db", SCHEMA_VERSION)
      );
      await expect(remote.getMeta()).resolves.toMatchObject({
        [SCHEMA_VERSION_KEY]: String(SCHEMA_VERSION)
      });
      await remote.close();
    });

    it("rejects a mismatched schema as a SchemaVersionError", async () => {
      // WHY: the panel tells "update the dictionary" from "report a problem" by this error's TYPE.
      // Only its message crosses the thread boundary; rebuilt as a plain Error, an old dictionary
      // would ask the user to file a bug instead of offering the update that fixes it.
      let lost = 0;
      const error = await openRemote<Dictionary>(
        WORKER,
        "words",
        database("old.db", SCHEMA_VERSION - 1),
        () => lost++
      ).catch((error_: unknown) => error_);
      expect(error).toBeInstanceOf(SchemaVersionError);
      expect(error).toMatchObject({
        expected: SCHEMA_VERSION,
        found: SCHEMA_VERSION - 1
      });
      // A failed open is a rejection, not a loss.
      expect(lost).toBe(0);
    });

    it("releases the file when closed", async () => {
      // WHY: an update renames the new download onto this file. On Windows that fails while any
      // handle is open, so a worker that kept the file open would make every update fail. (Only
      // Windows can see this fail: elsewhere, an open file can be removed.)
      let lost = 0;
      const path = database("release.db", SCHEMA_VERSION);
      const remote = await openRemote<Dictionary>(WORKER, "words", path, () => {
        lost++;
      });
      await remote.close();
      expect(() => rmSync(path)).not.toThrow();
      // Closing is deliberate (an update closes at the swap); it must not count as a loss.
      expect(lost).toBe(0);
    });

    it("keeps serving after a call fails", async () => {
      // WHY: one bad request must fail alone, not take the dictionary down for the session.
      const remote = await openRemote<{
        missing: () => Promise<void>;
        getMeta: () => Promise<Record<string, string>>;
      }>(WORKER, "words", database("serving.db", SCHEMA_VERSION));
      await expect(remote.missing()).rejects.toThrow(/no method "missing"/u);
      await expect(remote.getMeta()).resolves.toBeDefined();
      await remote.close();
    });

    it("keeps the worker's stack on an error", async () => {
      // WHY: a crash report carries the error's stack. Rebuilt without it, every dictionary bug
      // report would point at the message handler in remote.ts, not at the query that failed.
      const remote = await openRemote<{ missing: () => Promise<void> }>(
        WORKER,
        "words",
        database("stack.db", SCHEMA_VERSION)
      );
      const error = await remote.missing().catch((error_: unknown) => error_);
      await remote.close();
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).stack).toMatch(/dictionaryWorker\.cjs/u);
    });
  });

  describe("a worker that stops on its own", () => {
    it("fails every call at once and reports the loss", async () => {
      // WHY: an in-process database could not die; a worker can. Calls waiting on it — and calls made
      // after — would otherwise wait for an answer that cannot come, and the panel would search forever.
      const script = join(dir, "dies.cjs");
      writeFileSync(
        script,
        `const { parentPort } = require("node:worker_threads");
         parentPort.postMessage({ id: 0, ok: true, value: undefined });
         parentPort.on("message", () => process.exit(1));`
      );
      let lost = 0;
      const remote = await openRemote<{ ping: () => Promise<void> }>(
        script,
        "words",
        "unused",
        () => lost++
      );
      await expect(remote.ping()).rejects.toThrow(/stopped/u);
      expect(lost).toBe(1);
      await expect(remote.ping()).rejects.toThrow(/stopped/u);
      await expect(remote.close()).resolves.toBeUndefined();
    });
  });

  describe.skipIf(!existsSync(WORKER) || !existsSync(DB_PATH))(
    "the dictionary worker, against the built jisho.db",
    () => {
      it("leaves the extension host's thread free during a slow query", async () => {
        // WHY: this is the point of the worker. The extension host is ONE thread shared by every
        // extension; run here, this query blocked all of them for its whole length (~1.7 s on the
        // full dictionary — audit P-1). Measured through the worker: one timer tick (~16 ms).
        const noun: Classifier = {
          id: "noun",
          label: "Nouns",
          kind: "tag",
          tagKind: "pos",
          code: "n",
          prefix: false
        };
        const remote = await openRemote<Dictionary>(WORKER, "words", DB_PATH);
        let last = performance.now();
        let worst = 0;
        const timer = setInterval(() => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
        }, 1);
        const start = performance.now();
        await remote.refineCounts([noun]);
        const took = performance.now() - start;
        clearInterval(timer);
        await remote.close();
        // Only meaningful while the query is slow enough to stall anything; if it ever gets fast,
        // this asks for a slower one rather than passing for the wrong reason.
        expect(took).toBeGreaterThan(200);
        expect(worst).toBeLessThan(100);
      });
    }
  );
});
