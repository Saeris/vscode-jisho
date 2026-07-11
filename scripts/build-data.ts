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

// The `jmdict-examples-eng` variant adds an `examples` array per sense that the installed types
// don't cover (their README notes this). Declare the extra shape locally — verified against the
// real asset: each example has a source ref and ja/eng sentence pair.
interface JMdictExample {
  source: { type: string; value: string };
  /** The headword form the sentence exemplifies (unused by us; we key on the word itself). */
  text: string;
  sentences: Array<{ lang: string; text: string }>;
}
type SenseWithExamples = JMdictWord["sense"][number] & {
  examples?: JMdictExample[];
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DB = join(root, "assets", "jisho.db");
const SCHEMA = join(root, "src", "data", "schema.sql");
const RELEASE_API =
  "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

// `--full` builds the complete JMdict (~217k entries) — the variant delivered to users via the
// dictionary-latest GitHub Release. The default common-only subset (~22k) stays the dev/test
// fixture, filtered from the same source in-memory. The variant is recorded in `meta` and the
// version sidecar, so switching variants triggers ensureDatabase's refresh.
//
// Both variants source from `jmdict-examples-eng` (a strict superset of `jmdict-eng` that adds
// Tanaka-corpus example sentences per sense). Deriving the common fixture from the same asset means
// the dev/test DB exercises the exact example-ingestion path the shipped DB does.
const FULL = process.argv.includes("--full");
const VARIANT = FULL ? "full" : "common";
const ASSET_PATTERN = /^jmdict-examples-eng-\d.*\.json\.tgz$/;

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

// Word-level JLPT (unofficial): stephenmk/yomitan-jlpt-vocab is a curated reissue of Jonathan
// Waller's (tanos.co.uk) N5–N1 lists, CC-BY-SA-4.0. Its per-level CSVs key each word by
// `jmdict_seq` — the JMdict entry sequence number, i.e. our `words.id` — so the join is an exact
// PK match, not a lossy kanji+kana text match. Pinned to a commit for reproducibility.
const JLPT_REPO_SHA = "b062d4e38c4bdd0950ae1d4ec55f04b176182e03";
const JLPT_RAW_BASE = `https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/${JLPT_REPO_SHA}/original_data`;
// N5 (easiest) → stored as 5, N1 (hardest) → 1, mirroring the kanji-level jlpt scale's direction.
const JLPT_LEVELS: Array<{ file: string; level: number }> = [
  { file: "n5.csv", level: 5 },
  { file: "n4.csv", level: 4 },
  { file: "n3.csv", level: 3 },
  { file: "n2.csv", level: 2 },
  { file: "n1.csv", level: 1 }
];

// Pitch accent (Kanjium, CC-BY-SA-4.0). `accents.txt` is a TSV of `word ⇥ reading ⇥ pattern(s)`
// (124,137 rows). Reading is empty when the word is already kana; patterns are comma-separated
// mora numbers, sometimes with (POS) annotations we strip. Pinned to a commit for reproducibility.
const KANJIUM_SHA = "8a0cdaa16d64a281a2048de2eee2ec5e3a440fa6";
const KANJIUM_ACCENTS_URL = `https://raw.githubusercontent.com/mifunetoshiro/kanjium/${KANJIUM_SHA}/data/source_files/raw/accents.txt`;

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

/**
 * Fetch the yomitan-jlpt-vocab per-level CSVs and return a JMdict-id → level map. The CSV columns
 * are `jmdict_seq,kana,kanji,waller_definition`; we need only the id (first column) and the level
 * (from which file). Lower levels overwrite higher ones if a word appears in two lists (rare) so a
 * word keeps its easiest listed level. Parsing is line-based: the id is always a bare integer at
 * the start of the line, so we never need full CSV-quote handling (only later columns are quoted).
 */
const fetchJlptLevels = async (): Promise<Map<string, number>> => {
  const byId = new Map<string, number>();
  for (const { file, level } of JLPT_LEVELS) {
    const res = await fetch(`${JLPT_RAW_BASE}/${file}`, {
      headers: { "User-Agent": "vscode-jisho-build" }
    });
    if (!res.ok)
      throw new Error(`JLPT ${file} → ${res.status} ${res.statusText}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    for (const line of lines.slice(1)) {
      const seq = line.slice(0, line.indexOf(","));
      // Guard against blank lines / a stray header: ids are bare digit strings.
      if (!/^\d+$/.test(seq)) continue;
      // Easiest level wins; files are processed N5→N1, so only set if unseen.
      if (!byId.has(seq)) byId.set(seq, level);
    }
  }
  return byId;
};

/**
 * Fetch Kanjium's accents.txt and return a `surface\treading` → mora-position[] map. Each row is
 * `word ⇥ reading ⇥ pattern(s)`; the reading column is empty when the word is itself kana (so the
 * surface *is* the reading). Patterns are comma-separated mora numbers, occasionally carrying
 * `(POS)` annotations (e.g. `(副)0,(名)3`) which we strip — we keep only the distinct numeric
 * positions in order. The key uses `\t` (never present in either field) as a safe separator.
 */
const fetchPitchAccents = async (): Promise<Map<string, number[]>> => {
  const res = await fetch(KANJIUM_ACCENTS_URL, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok)
    throw new Error(`Kanjium accents → ${res.status} ${res.statusText}`);
  const text = await res.text();
  const map = new Map<string, number[]>();
  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    const cols = line.split("\t");
    // Need at least word + pattern columns; a malformed line without tabs is skipped.
    if (cols.length < 3) continue;
    const word = cols[0];
    const patternRaw = cols[2];
    const reading = cols[1] === "" ? word : cols[1];
    // Strip (POS) annotations, then take the distinct integer mora positions in order.
    const positions: number[] = [];
    for (const part of patternRaw.replace(/\([^)]*\)/g, "").split(",")) {
      const n = Number.parseInt(part.trim(), 10);
      if (!Number.isNaN(n) && !positions.includes(n)) positions.push(n);
    }
    if (positions.length > 0) map.set(`${word}\t${reading}`, positions);
  }
  return map;
};

interface Sources {
  dict: JMdict;
  kanjidic: Kanjidic2;
  kradfile: Kradfile;
  radkfile: Radkfile;
  jlpt: Map<string, number>;
  pitch: Map<string, number[]>;
}

const downloadSources = async (): Promise<Sources> => {
  console.log("Resolving latest jmdict-simplified release…");
  const release = await fetchJson<GithubRelease>(RELEASE_API);
  console.log(`Release ${release.tag_name}`);
  const [dict, kanjidic, kradfile, radkfile, jlpt, pitch] = await Promise.all([
    fetchAssetJson<JMdict>(release, ASSET_PATTERN),
    fetchAssetJson<Kanjidic2>(release, KANJIDIC_PATTERN),
    fetchAssetJson<Kradfile>(release, KRADFILE_PATTERN),
    fetchAssetJson<Radkfile>(release, RADKFILE_PATTERN),
    fetchJlptLevels(),
    fetchPitchAccents()
  ]);
  // Both variants download the full examples asset; the common fixture keeps only common entries
  // (a word with any common kanji/kana writing), matching what jmdict-eng-common used to contain.
  if (!FULL) {
    const before = dict.words.length;
    dict.words = dict.words.filter(
      (w) => w.kanji.some((k) => k.common) || w.kana.some((k) => k.common)
    );
    console.log(
      `Filtered to common entries: ${dict.words.length}/${before} words`
    );
  }
  return { dict, kanjidic, kradfile, radkfile, jlpt, pitch };
};

const buildDatabase = async (sources: Sources): Promise<void> => {
  const { dict, kanjidic, kradfile, radkfile, jlpt, pitch } = sources;
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
  const insSentence = await db.prepare(
    "INSERT INTO sentences(word_id, sense_position, position, ja, en) VALUES (?, ?, ?, ?, ?)"
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
  const insPitch = await db.prepare(
    "INSERT INTO pitch_accents(word_id, reading, accents_json) VALUES (?, ?, ?)"
  );

  // Commit in batches and checkpoint between them: a single giant transaction can never fold its
  // pages back into the main file, so the WAL balloons unboundedly (the full build's WAL passed
  // 5GB before this fix). Checkpointing per batch keeps the WAL at roughly one batch's size.
  const BATCH = 5000;
  const total = dict.words.length;
  let done = 0;
  let sentenceRows = 0;
  for (const word of dict.words) {
    sentenceRows += await importWord(word, {
      insWord,
      insKanji,
      insKana,
      insSense,
      insGloss,
      insTerm,
      insSentence
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

  // ── Pitch accent pass (Kanjium) ───────────────────────────────────────────
  // Join per word: for each reading, look for a pitch pattern keyed by (a writing, reading) — or
  // (reading, reading) for kana-only words / when no kanji writing matches. The map's key was
  // built the same way (`surface\treading`, surface being a writing or the reading itself). One
  // row per (word, reading) that hit; readings with no accent data are simply omitted.
  await db.exec("BEGIN");
  let pitchRows = 0;
  let pdone = 0;
  for (const word of dict.words) {
    const writings =
      word.kanji.length > 0 ? word.kanji.map((k) => k.text) : [""];
    for (const kana of word.kana) {
      const reading = kana.text;
      // Prefer a writing-specific pattern; fall back to the reading keyed against itself.
      let positions: number[] | undefined;
      for (const w of writings) {
        positions = pitch.get(`${w === "" ? reading : w}\t${reading}`);
        if (positions) break;
      }
      positions ??= pitch.get(`${reading}\t${reading}`);
      if (positions) {
        await insPitch.run(word.id, reading, JSON.stringify(positions));
        pitchRows++;
      }
    }
    if (++pdone % BATCH === 0) {
      await db.exec("COMMIT");
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      await db.exec("BEGIN");
    }
  }
  await db.exec("COMMIT");
  console.log(`  pitch: ${pitchRows} (word, reading) accent rows`);

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

  // ── JLPT pass ─────────────────────────────────────────────────────────────
  // Join word-level JLPT by JMdict id (exact PK). Only ids present in this variant's JMdict get
  // updated, so the common-only build naturally covers fewer list rows than the full build. Record
  // the match rate so a poor join (a sign the source drifted from JMdict) is visible in `meta`.
  await db.exec("BEGIN");
  const updJlpt = await db.prepare("UPDATE words SET jlpt = ? WHERE id = ?");
  let jlptMatched = 0;
  let jdone = 0;
  for (const [id, level] of jlpt) {
    const { changes } = await updJlpt.run(level, id);
    if (changes > 0) jlptMatched++;
    if (++jdone % BATCH === 0) {
      await db.exec("COMMIT");
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      await db.exec("BEGIN");
    }
  }
  await db.exec("COMMIT");
  const jlptRate =
    jlpt.size > 0 ? ((jlptMatched / jlpt.size) * 100).toFixed(1) : "0";
  console.log(
    `  jlpt: ${jlptMatched}/${jlpt.size} words matched (${jlptRate}% of list)`
  );

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
  await insMeta.run(
    "jlptSource",
    "JLPT levels (unofficial): Jonathan Waller / tanos.co.uk, via stephenmk/yomitan-jlpt-vocab"
  );
  await insMeta.run(
    "jlptLicense",
    "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)"
  );
  await insMeta.run("jlptMatched", String(jlptMatched));
  await insMeta.run(
    "pitchSource",
    "Pitch accent: Kanjium (Uros O.), from NHK/Wadoku data"
  );
  await insMeta.run(
    "pitchLicense",
    "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)"
  );
  await insMeta.run("pitchRows", String(pitchRows));
  await insMeta.run(
    "sentenceSource",
    "Example sentences: Tanaka corpus, via Tatoeba (embedded in jmdict-examples-eng)"
  );
  await insMeta.run(
    "sentenceLicense",
    "CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/deed.en)"
  );
  await insMeta.run("sentenceRows", String(sentenceRows));
  console.log(`  sentences: ${sentenceRows} example rows`);
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
  insSentence: Statement;
}

/** Cap on example sentences kept per sense — the source averages ~1, but bound it defensively. */
const MAX_SENTENCES_PER_SENSE = 3;

/** Imports one word; returns the number of example sentences inserted for it. */
const importWord = async (word: JMdictWord, s: Stmts): Promise<number> => {
  const wordCommon =
    word.kanji.some((k) => k.common) || word.kana.some((k) => k.common) ? 1 : 0;
  await s.insWord.run(word.id, wordCommon);
  let sentenceCount = 0;

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

    // Example sentences (jmdict-examples-eng): keep up to MAX per sense, each a ja/en pair. Skip
    // any example missing either language (the source is occasionally one-sided).
    const examples = (sense as SenseWithExamples).examples ?? [];
    let kept = 0;
    for (const ex of examples) {
      if (kept >= MAX_SENTENCES_PER_SENSE) break;
      const ja = ex.sentences.find((se) => se.lang === "jpn")?.text;
      const en = ex.sentences.find((se) => se.lang === "eng")?.text;
      if (ja === undefined || en === undefined) continue;
      await s.insSentence.run(word.id, i, kept, ja, en);
      kept++;
    }
    sentenceCount += kept;
  }
  return sentenceCount;
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
