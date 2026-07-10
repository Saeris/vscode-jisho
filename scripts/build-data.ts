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
import { createGzip, gunzipSync } from "node:zlib";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "@tursodatabase/database";
import { toRomaji } from "wanakana";
import type {
  JMdict,
  JMdictWord,
  Kanjidic2,
  Kanjidic2Character,
  Kradfile,
  Radkfile
} from "@scriptin/jmdict-simplified-types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DB = join(root, "assets", "jisho.db");
const SCHEMA = join(root, "src", "data", "schema.sql");
const RELEASE_API =
  "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

// `--full` builds the complete JMdict (~217k entries) — the variant delivered to users via the
// dictionary-latest GitHub Release. The default common-only subset (~22k) stays the dev/test
// fixture. The variant is recorded in `meta` and the version sidecar, so switching variants
// triggers ensureDatabase's refresh.
const FULL = process.argv.includes("--full");
const VARIANT = FULL ? "full" : "common";
const ASSET_PATTERN = FULL
  ? /^jmdict-eng-\d.*\.json\.tgz$/
  : /^jmdict-eng-common-.*\.json\.tgz$/;

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

// The kanji datasets are single-variant (not full/common), so their asset names are stable.
const KANJIDIC_PATTERN = /^kanjidic2-en-.*\.json\.tgz$/;
const KRADFILE_PATTERN = /^kradfile-.*\.json\.tgz$/;
const RADKFILE_PATTERN = /^radkfile-.*\.json\.tgz$/;

/** Download one .json.tgz asset matching `pattern` from the resolved release and parse it. */
const fetchAssetJson = async <T>(
  release: GithubRelease,
  pattern: RegExp
): Promise<T> => {
  const asset = release.assets.find((a) => pattern.test(a.name));
  if (!asset) throw new Error(`No release asset matching ${String(pattern)}`);
  console.log(`Downloading ${asset.name}…`);
  const res = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok)
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const tgz = new Uint8Array(await res.arrayBuffer());
  const data: T = JSON.parse(extractSingleJsonFromTgz(tgz));
  return data;
};

interface Sources {
  dict: JMdict;
  kanjidic: Kanjidic2;
  kradfile: Kradfile;
  radkfile: Radkfile;
}

const downloadSources = async (): Promise<Sources> => {
  console.log("Resolving latest jmdict-simplified release…");
  const release = await fetchJson<GithubRelease>(RELEASE_API);
  console.log(`Release ${release.tag_name}`);
  const [dict, kanjidic, kradfile, radkfile] = await Promise.all([
    fetchAssetJson<JMdict>(release, ASSET_PATTERN),
    fetchAssetJson<Kanjidic2>(release, KANJIDIC_PATTERN),
    fetchAssetJson<Kradfile>(release, KRADFILE_PATTERN),
    fetchAssetJson<Radkfile>(release, RADKFILE_PATTERN)
  ]);
  return { dict, kanjidic, kradfile, radkfile };
};

const buildDatabase = async (sources: Sources): Promise<void> => {
  const { dict, kanjidic, kradfile, radkfile } = sources;
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
    "INSERT INTO search_terms(word_id, kind, term, term_lower, is_common, is_primary) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insKanjiChar = await db.prepare(
    `INSERT INTO kanji_characters(literal, grade, stroke_count, frequency, jlpt,
       on_json, kun_json, meanings_json, nanori_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insComponent = await db.prepare(
    "INSERT INTO kanji_components(literal, component) VALUES (?, ?)"
  );
  const insRadical = await db.prepare(
    "INSERT INTO radicals(radical, stroke_count, kanji_json) VALUES (?, ?, ?)"
  );
  const insKanjiTerm = await db.prepare(
    "INSERT INTO search_terms(kanji, kind, term, term_lower, is_common, is_primary) VALUES (?, ?, ?, ?, ?, ?)"
  );

  // Commit in batches and checkpoint between them: a single giant transaction can never fold its
  // pages back into the main file, so the WAL balloons unboundedly (the full build's WAL passed
  // 5GB before this fix). Checkpointing per batch keeps the WAL at roughly one batch's size.
  const BATCH = 5000;
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
    done++;
    if (done % BATCH === 0) {
      await db.exec("COMMIT");
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      await db.exec("BEGIN");
      console.log(`  …${done}/${total} entries`);
    }
  }

  await db.exec("COMMIT");

  // ── Kanji pass ────────────────────────────────────────────────────────────
  // Import characters first (search_terms.kanji FK-references kanji_characters), then their
  // Kradfile components, then Radkfile radicals. Same batched-checkpoint discipline.
  await db.exec("BEGIN");
  const kanjiSet = new Set<string>();
  let kdone = 0;
  for (const char of kanjidic.characters) {
    await importKanji(char, { insKanjiChar, insKanjiTerm });
    kanjiSet.add(char.literal);
    if (++kdone % BATCH === 0) {
      await db.exec("COMMIT");
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      await db.exec("BEGIN");
    }
  }
  // Kradfile components — only for kanji we have a character row for (FK).
  for (const [literal, components] of Object.entries(kradfile.kanji)) {
    if (!kanjiSet.has(literal)) continue;
    for (const component of components) {
      await insComponent.run(literal, component);
    }
  }
  // Radkfile radicals.
  for (const [radical, info] of Object.entries(radkfile.radicals)) {
    await insRadical.run(radical, info.strokeCount, JSON.stringify(info.kanji));
  }
  await db.exec("COMMIT");
  console.log(`  kanji: ${kanjiSet.size} characters`);

  // Attribution / provenance.
  const insMeta = await db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?)"
  );
  await insMeta.run("source", `JMdict (jmdict-simplified, eng-${VARIANT})`);
  await insMeta.run("dictDate", dict.dictDate);
  await insMeta.run("dictRevisions", dict.dictRevisions.join(", "));
  await insMeta.run(
    "license",
    "EDRDG License (https://www.edrdg.org/edrdg/licence.html)"
  );
  await insMeta.run("kanjidicDate", kanjidic.dictDate);
  await insMeta.run("kanjidicVersion", kanjidic.databaseVersion);
  await insMeta.run("kanjiCount", String(kanjiSet.size));
  const builtAt = new Date().toISOString();
  await insMeta.run("variant", VARIANT);
  await insMeta.run("wordCount", String(total));
  await insMeta.run("builtAt", builtAt);

  // Fold the WAL back into the main file so `jisho.db` is a self-contained, shippable artifact
  // (we deliver only the single .db; a leftover -wal would be required at read time otherwise).
  await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await db.close();

  // Emit a tiny version sidecar so `ensureDatabase` can detect a newer build (or a variant
  // switch) and refresh the copy it caches in globalStorage — without having to open (and lock)
  // the database to read its meta.
  const version = `${VARIANT} ${dict.dictDate} ${builtAt}`;
  writeFileSync(`${OUT_DB}.version`, version, "utf8");
  console.log(`\nWrote ${OUT_DB} — ${total} entries (${VARIANT}).`);

  // The full variant is delivered via the dictionary-latest GitHub Release: emit the gzipped
  // asset, its sha256, and the version string the downloader compares against its sidecar.
  if (FULL) {
    console.log("Compressing release asset…");
    const gzPath = join(dirname(OUT_DB), "jisho-full.db.gz");
    await pipeline(
      createReadStream(OUT_DB),
      createGzip({ level: 9 }),
      createWriteStream(gzPath)
    );
    const hash = createHash("sha256");
    await pipeline(createReadStream(gzPath), hash);
    writeFileSync(`${gzPath}.sha256`, hash.digest("hex"), "utf8");
    writeFileSync(
      join(dirname(OUT_DB), "jisho-full.db.version"),
      version,
      "utf8"
    );
    console.log(`Wrote ${gzPath} (+ .sha256, .version)`);
  }
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
      k.common ? 1 : 0,
      i === 0 ? 1 : 0
    );
    // Index each distinct CJK character of the writing so a single-kanji query (強) finds words
    // containing it (勉強) via an *exact* char-row match — substring LIKE scans are too slow at
    // full-dictionary scale, so containment is precomputed here instead.
    for (const char of new Set(k.text)) {
      if (/[㐀-鿿豈-﫿]/.test(char)) {
        await s.insTerm.run(word.id, "char", char, char, k.common ? 1 : 0, 0);
      }
    }
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
      k.common ? 1 : 0,
      i === 0 ? 1 : 0
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
        k.common ? 1 : 0,
        i === 0 ? 1 : 0
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
      const isPrimary = i === 0 && g === 0 ? 1 : 0;
      await s.insGloss.run(senseId, g, gloss.lang, gloss.text);
      await s.insTerm.run(
        word.id,
        "gloss",
        gloss.text,
        gloss.text.toLowerCase(),
        wordCommon,
        isPrimary
      );
      // Many JMdict glosses carry parenthetical clarifications — "water (esp. cool or cold)" —
      // which block exact/whole-word matching on the bare word. Index a stripped variant too so
      // "water" matches 水 exactly.
      const stripped = gloss.text
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped !== "" && stripped !== gloss.text) {
        await s.insTerm.run(
          word.id,
          "gloss",
          stripped,
          stripped.toLowerCase(),
          wordCommon,
          isPrimary
        );
      }
      // Index each word of the gloss so "eat" finds "to eat" via an *exact* word-row match —
      // the index-friendly replacement for word-boundary LIKE scans over whole glosses.
      const words = new Set(
        (stripped === "" ? gloss.text : stripped)
          .toLowerCase()
          .split(/[^a-z0-9']+/)
          .filter((w) => w.length > 1)
      );
      for (const w of words) {
        await s.insTerm.run(word.id, "word", w, w, wordCommon, isPrimary);
      }
    }
  }
};

interface KanjiStmts {
  insKanjiChar: Statement;
  insKanjiTerm: Statement;
}

const importKanji = async (
  char: Kanjidic2Character,
  s: KanjiStmts
): Promise<void> => {
  const groups = char.readingMeaning?.groups ?? [];
  const on: string[] = [];
  const kun: string[] = [];
  const meanings: string[] = [];
  for (const group of groups) {
    for (const r of group.readings) {
      if (r.type === "ja_on") on.push(r.value);
      else if (r.type === "ja_kun") kun.push(r.value);
    }
    for (const m of group.meanings) {
      if (m.lang === "en") meanings.push(m.value);
    }
  }
  const nanori = char.readingMeaning?.nanori ?? [];
  const isCommon = char.misc.frequency !== null ? 1 : 0;

  await s.insKanjiChar.run(
    char.literal,
    char.misc.grade,
    char.misc.strokeCounts[0] ?? null,
    char.misc.frequency,
    char.misc.jlptLevel,
    JSON.stringify(on),
    JSON.stringify(kun),
    JSON.stringify(meanings),
    JSON.stringify(nanori)
  );

  // The literal itself, matched exactly for a single-character CJK query.
  await s.insKanjiTerm.run(
    char.literal,
    "kanji_literal",
    char.literal,
    char.literal,
    isCommon,
    1
  );
  // Each meaning word, so an English query ("eat") surfaces the character. Mirrors how word
  // glosses are tokenized into `word` rows — exact/prefix index hits, no LIKE scan.
  const words = new Set(
    meanings
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 1)
  );
  for (const w of words) {
    await s.insKanjiTerm.run(char.literal, "kanji_meaning", w, w, isCommon, 0);
  }
};

console.time("build-data");
const sources = await downloadSources();
await buildDatabase(sources);
console.timeEnd("build-data");
