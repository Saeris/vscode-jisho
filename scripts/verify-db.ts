/**
 * Post-build verification for a release database (spec 05 §2 step 3). A corrupt or half-built
 * artifact silently breaks every new install, so the data workflow runs this before uploading:
 * re-open the built DB and assert it actually answers, its `meta.schemaVersion` matches the version
 * the shipped extension expects, and the compressed `.zst` matches its own `.sha256` sidecar.
 *
 *   vp exec node scripts/verify-db.ts <db-path> [--zst <path>] [--names]
 *
 * `--names` switches the query assertions to the JMnedict names DB (different schema). `--zst`
 * points at the compressed artifact whose checksum to re-verify (defaults to none). Exits non-zero
 * with a clear message on the first failed check.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { connect } from "@tursodatabase/database";
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from "../src/shared/schema.ts";

const fail = (message: string): never => {
  console.error(`verify-db: ${message}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const positional = argv.find((a) => !a.startsWith("--"));
const isNames = argv.includes("--names");
const zstIndex = argv.indexOf("--zst");
const zstPath = zstIndex !== -1 ? argv[zstIndex + 1] : undefined;

const dbPath =
  positional ?? fail("usage: verify-db.ts <db-path> [--zst <path>] [--names]");
if (!existsSync(dbPath)) fail(`database not found: ${dbPath}`);

const db = await connect(dbPath);

const scalar = async (sql: string, ...params: unknown[]): Promise<unknown> => {
  const rows: unknown = await (await db.prepare(sql)).all(...params);
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) return undefined;
  const values = Object.values(row);
  return values.length > 0 ? values[0] : undefined;
};

// 1. Schema version present and matching what the extension expects. The names DB carries no schema
//    version (it is not gated the same way), so this check is word-DB only.
if (!isNames) {
  const stamped = await scalar(
    "SELECT value FROM meta WHERE key = ?",
    SCHEMA_VERSION_KEY
  );
  if (stamped === undefined) {
    fail(
      `meta.${SCHEMA_VERSION_KEY} is missing — the build did not stamp the schema version`
    );
  }
  if (Number(stamped) !== SCHEMA_VERSION) {
    fail(
      `meta.${SCHEMA_VERSION_KEY} is ${String(stamped)} but the extension expects ${SCHEMA_VERSION}`
    );
  }
}

// 2. Known queries answer — a build that produced an empty or truncated table would fail here.
if (isNames) {
  const nameCount = Number(
    await scalar("SELECT COUNT(*) AS c FROM name_words")
  );
  if (!(nameCount > 0))
    fail(`names DB has no name_words rows (got ${nameCount})`);
} else {
  const wordCount = Number(await scalar("SELECT COUNT(*) AS c FROM words"));
  if (!(wordCount > 0)) fail(`words table is empty (got ${wordCount})`);

  // 食べる (JMdict 1358280) must resolve — a canary that the core word data imported.
  const taberu = Number(
    await scalar("SELECT COUNT(*) AS c FROM words WHERE id = '1358280'")
  );
  if (taberu !== 1) fail("canary word 食べる (id 1358280) is missing");

  // 食 must resolve as a kanji — a canary that the kanji pass ran.
  const shoku = Number(
    await scalar(
      "SELECT COUNT(*) AS c FROM kanji_characters WHERE literal = '食'"
    )
  );
  if (shoku !== 1) fail("canary kanji 食 is missing");
}

await db.close();

// 3. The compressed artifact matches its own sha256 sidecar (what the downloader will verify).
if (zstPath !== undefined) {
  if (!existsSync(zstPath)) fail(`compressed artifact not found: ${zstPath}`);
  if (!existsSync(`${zstPath}.sha256`))
    fail(`checksum sidecar not found: ${zstPath}.sha256`);
  const expected = readFileSync(`${zstPath}.sha256`, "utf8").trim();
  const hash = createHash("sha256");
  await pipeline(createReadStream(zstPath), hash);
  const actual = hash.digest("hex");
  if (actual !== expected) {
    fail(
      `checksum mismatch for ${zstPath}: sidecar ${expected.slice(0, 12)}… vs actual ${actual.slice(0, 12)}…`
    );
  }
}

console.log(
  `verify-db: OK — ${isNames ? "names" : "word"} DB at ${dbPath}${zstPath ? ` (+ ${zstPath} checksum)` : ""}`
);
