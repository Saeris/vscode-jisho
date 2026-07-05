/**
 * Data build: download the latest `jmdict-eng-common` release from jmdict-simplified,
 * transform it into a Turso/SQLite database (`assets/jisho.db`) using `src/data/schema.sql`,
 * and record source/attribution metadata.
 *
 * Run occasionally (NOT part of `vp pack`/`vp build`):  `vp run build:data`
 *
 * Pure Node (fetch + zlib + a minimal tar reader) so it runs anywhere without extra deps
 * or system tools. Node 26 executes this .ts file directly via type-stripping.
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "@tursodatabase/database";
import { toRomaji } from "wanakana";
import type { JMdict, JMdictWord } from "@scriptin/jmdict-simplified-types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DB = join(root, "assets", "jisho.db");
const SCHEMA = join(root, "src", "data", "schema.sql");
const RELEASE_API =
  "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

/** Extract the single JSON file from a gzipped tar (one-member archive). */
const extractSingleJsonFromTgz = (tgz: Uint8Array): string => {
  const tar = gunzipSync(tgz);
  // tar = concatenated 512-byte records. Each file: a 512-byte header then its
  // content padded to a 512-byte boundary. We want the first regular file.
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = decodeCString(header.subarray(0, 100));
    if (name === "") break; // two zero blocks mark end of archive
    // size is an octal ASCII string in bytes 124..135
    const size = parseInt(decodeCString(header.subarray(124, 136)), 8) || 0;
    const type = String.fromCharCode(header[156]); // '0' or '\0' = regular file
    const contentStart = offset + 512;
    if ((type === "0" || type === "\0") && name.endsWith(".json")) {
      return Buffer.from(
        tar.subarray(contentStart, contentStart + size)
      ).toString("utf8");
    }
    // advance past content, rounded up to the next 512-byte record
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  throw new Error("No .json file found inside the .tgz archive");
};

const decodeCString = (bytes: Uint8Array): string => {
  const nul = bytes.indexOf(0);
  return Buffer.from(bytes.subarray(0, nul === -1 ? bytes.length : nul))
    .toString("utf8")
    .trim();
};

// The build script trusts the shapes of the GitHub API / JMdict JSON it fetches; a generic return
// type keeps the (unavoidable) trust boundary at these two functions rather than at every call site.
const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  const data: T = await res.json();
  return data;
};

interface GithubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

const downloadDictionary = async (): Promise<JMdict> => {
  console.log("Resolving latest jmdict-simplified release…");
  const release = await fetchJson<GithubRelease>(RELEASE_API);
  const asset = release.assets.find((a) =>
    /^jmdict-eng-common-.*\.json\.tgz$/.test(a.name)
  );
  if (!asset)
    throw new Error("Could not find a jmdict-eng-common .json.tgz asset");
  console.log(`Downloading ${asset.name} (release ${release.tag_name})…`);
  const res = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok)
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const tgz = new Uint8Array(await res.arrayBuffer());
  console.log(
    `Extracting (${(tgz.length / 1024 / 1024).toFixed(1)} MB compressed)…`
  );
  const dict: JMdict = JSON.parse(extractSingleJsonFromTgz(tgz));
  return dict;
};

const buildDatabase = async (dict: JMdict): Promise<void> => {
  mkdirSync(dirname(OUT_DB), { recursive: true });
  rmSync(OUT_DB, { force: true });
  rmSync(`${OUT_DB}-wal`, { force: true });
  rmSync(`${OUT_DB}-shm`, { force: true });

  const db = await connect(OUT_DB);
  await db.exec(readFileSync(SCHEMA, "utf8"));

  // Bulk-import fast path: one transaction + relaxed durability. This is a build artifact we
  // can regenerate at will, so trading crash-safety for ~30× throughput is the right call.
  // (Without a wrapping transaction, every INSERT commits+fsyncs individually.)
  await db.exec("PRAGMA synchronous=OFF");
  await db.exec("BEGIN");

  // Tag dictionary.
  const insTag = await db.prepare(
    "INSERT INTO tags(tag, description) VALUES (?, ?)"
  );
  for (const [tag, description] of Object.entries(dict.tags)) {
    await insTag.run(tag, description);
  }

  const insWord = await db.prepare(
    "INSERT INTO words(id, is_common) VALUES (?, ?)"
  );
  const insKanji = await db.prepare(
    "INSERT INTO kanji(word_id, position, text, is_common, tags_json) VALUES (?, ?, ?, ?, ?)"
  );
  const insKana = await db.prepare(
    "INSERT INTO kana(word_id, position, text, is_common, tags_json, applies_to_kanji_json) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insSense = await db.prepare(
    `INSERT INTO senses(word_id, position, pos_json, field_json, misc_json, info_json, dialect_json,
       applies_to_kanji_json, applies_to_kana_json, related_json, antonym_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insGloss = await db.prepare(
    "INSERT INTO glosses(sense_id, position, lang, text) VALUES (?, ?, ?, ?)"
  );
  const insTerm = await db.prepare(
    "INSERT INTO search_terms(word_id, kind, term, term_lower, is_common) VALUES (?, ?, ?, ?, ?)"
  );

  const total = dict.words.length;
  let done = 0;
  for (const word of dict.words) {
    await importWord(word, {
      insWord,
      insKanji,
      insKana,
      insSense,
      insGloss,
      insTerm
    });
    if (++done % 2000 === 0) console.log(`  …${done}/${total} entries`);
  }

  await db.exec("COMMIT");

  // Attribution / provenance.
  const insMeta = await db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?)"
  );
  await insMeta.run("source", "JMdict (jmdict-simplified, eng-common)");
  await insMeta.run("dictDate", dict.dictDate);
  await insMeta.run("dictRevisions", dict.dictRevisions.join(", "));
  await insMeta.run(
    "license",
    "EDRDG License (https://www.edrdg.org/edrdg/licence.html)"
  );
  await insMeta.run("wordCount", String(total));
  await insMeta.run("builtAt", new Date().toISOString());

  // Fold the WAL back into the main file so `jisho.db` is a self-contained, shippable artifact
  // (we deliver only the single .db; a leftover -wal would be required at read time otherwise).
  await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await db.close();
  console.log(`\nWrote ${OUT_DB} — ${total} entries.`);
};

// A prepared statement, as returned by the (async) `prepare` once awaited.
type Statement = Awaited<
  ReturnType<Awaited<ReturnType<typeof connect>>["prepare"]>
>;

interface Stmts {
  insWord: Statement;
  insKanji: Statement;
  insKana: Statement;
  insSense: Statement;
  insGloss: Statement;
  insTerm: Statement;
}

const importWord = async (word: JMdictWord, s: Stmts): Promise<void> => {
  const wordCommon =
    word.kanji.some((k) => k.common) || word.kana.some((k) => k.common) ? 1 : 0;
  await s.insWord.run(word.id, wordCommon);

  for (let i = 0; i < word.kanji.length; i++) {
    const k = word.kanji[i];
    await s.insKanji.run(
      word.id,
      i,
      k.text,
      k.common ? 1 : 0,
      JSON.stringify(k.tags)
    );
    await s.insTerm.run(
      word.id,
      "kanji",
      k.text,
      k.text.toLowerCase(),
      k.common ? 1 : 0
    );
  }
  for (let i = 0; i < word.kana.length; i++) {
    const k = word.kana[i];
    await s.insKana.run(
      word.id,
      i,
      k.text,
      k.common ? 1 : 0,
      JSON.stringify(k.tags),
      JSON.stringify(k.appliesToKanji)
    );
    await s.insTerm.run(
      word.id,
      "kana",
      k.text,
      k.text.toLowerCase(),
      k.common ? 1 : 0
    );
    // Hepburn romaji of the reading, so learners can search by transliteration ("taberu").
    // Romaji is latin, so it matches via the query layer's case-insensitive `term_lower` path.
    const romaji = toRomaji(k.text);
    if (romaji !== "" && romaji !== k.text) {
      await s.insTerm.run(
        word.id,
        "romaji",
        romaji,
        romaji.toLowerCase(),
        k.common ? 1 : 0
      );
    }
  }
  for (let i = 0; i < word.sense.length; i++) {
    const sense = word.sense[i];
    const { lastInsertRowid: senseId } = await s.insSense.run(
      word.id,
      i,
      JSON.stringify(sense.partOfSpeech),
      JSON.stringify(sense.field),
      JSON.stringify(sense.misc),
      JSON.stringify(sense.info),
      JSON.stringify(sense.dialect),
      JSON.stringify(sense.appliesToKanji),
      JSON.stringify(sense.appliesToKana),
      JSON.stringify(sense.related),
      JSON.stringify(sense.antonym)
    );
    for (let g = 0; g < sense.gloss.length; g++) {
      const gloss = sense.gloss[g];
      await s.insGloss.run(senseId, g, gloss.lang, gloss.text);
      await s.insTerm.run(
        word.id,
        "gloss",
        gloss.text,
        gloss.text.toLowerCase(),
        wordCommon
      );
    }
  }
};

console.time("build-data");
const dict = await downloadDictionary();
await buildDatabase(dict);
console.timeEnd("build-data");
