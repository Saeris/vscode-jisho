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
import { createGunzip, createGzip, gunzipSync } from "node:zlib";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { finished, pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "@tursodatabase/database";
import { toRomaji } from "wanakana";
import type {
  JMdict,
  JMdictWord,
  JMnedict,
  JMnedictWord,
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
const NAMES_DB = join(root, "assets", "jisho-names.db");
const NAMES_SCHEMA = join(root, "src", "data", "names-schema.sql");
// Vendored kanji stroke-order SVGs (AnimCJK, APL — see assets/kanji-svgs/README.md). One file per
// literal, ingested verbatim into the stroke_svgs table.
const STROKE_SVG_DIR = join(root, "assets", "kanji-svgs");
const RELEASE_API =
  "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

// `--names` builds the separate JMnedict names database (`jisho-names.db`), an optional download
// delivered as its own `jisho-names.db.gz` trio on the dictionary-latest release. It's ~743k
// entries and would roughly double the main DB, so it's never bundled into it. Runs independently
// of the word/kanji build.
const NAMES = process.argv.includes("--names");
const NAMES_ASSET_PATTERN = /^jmnedict-all-\d.*\.json\.tgz$/;

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

// Recursive kanji decomposition (cjk-decomp, amake fork). Multi-licensed — the README grants "6
// licenses, of which you only need choose one", MIT among them, and the committed LICENSE file is
// Apache-2.0; either fits our MIT extension (unlike cjkvi-ids, whose ids.txt is CHISE-derived
// GPLv2). We attribute under Apache-2.0. Pinned to a commit for reproducibility.
//
// Format: one record per line, `char:type(part,part,…)` — e.g. `願:a(原,頁)`. `type` is the spatial
// arrangement (a=across, d=down, s=surround…), which we ignore; we want the child list. Parts recurse
// down to stroke primitives (㇒ ㇐) and PUA glyphs, well past the useful level — so the tree is
// pruned to children present in Kanjidic (the set we can show meanings for), which also bounds depth.
const CJK_DECOMP_SHA = "c29b391fd6267e7a3541387e03a3dd60b1cd34d1";
const CJK_DECOMP_URL = `https://raw.githubusercontent.com/amake/cjk-decomp/${CJK_DECOMP_SHA}/cjk-decomp.txt`;

// JMdict priority tags (EDRDG, CC-BY-SA-4.0 — the same licence and source as our main dictionary,
// so no new licensing surface). jmdict-simplified deliberately collapses JMdict's `ke_pri`/`re_pri`
// fields into a single boolean `common`, discarding the underlying gradient; their own type docs say
// so ("It gets rid of a bunch of *_pri fields"). We therefore read the ORIGINAL XML for those two
// fields only.
//
// The gradient matters: with only `common`, every exact match ties and ordering falls to whatever
// SQLite returns — "eat" led with 食らう (a vulgar "devour") ahead of 食べる, and "water" led with
// 水分 (moisture) ahead of 水.
//
// Per the JMdict DTD, the values are:
//   news1/2 — in the top 12,000 / second 12,000 of Alexandre Girardi's Mainichi Shimbun wordfreq file
//   ichi1/2 — in "Ichimango goi bunruishuu" (ichi2 = demoted; observed to be low-frequency in practice)
//   spec1/2 — detected as common but absent from the other lists
//   gai1/2  — common loanwords, from wordfreq
//   nfXX    — THE RANKING: "the number of the set of 500 words in which the entry can be found",
//             01 = the first 500, 02 = the second, … ~48 buckets over the top ~24,000 words.
//
// Caveat worth remembering (see BACKLOG #26): wordfreq is a NEWSPAPER corpus, so it carries a
// newspaper's skew — 端 ("edge") outranks 箸 ("chopsticks") because edges make the news and
// chopsticks don't. It fixes the worst cases, not every case.
const JMDICT_XML_URL = "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz";

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
 * Fetch cjk-decomp and return each character's DIRECT component children (unpruned). The parse is
 * line-based: `char:type(a,b,c)` → [a, b, c]. The spatial `type` code is discarded.
 */
const fetchDecomposition = async (): Promise<Map<string, string[]>> => {
  console.log("Downloading cjk-decomp.txt…");
  const res = await fetch(CJK_DECOMP_URL, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok) throw new Error(`cjk-decomp → ${res.status} ${res.statusText}`);
  const text = await res.text();
  const map = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.+?):[a-z0-9]+\((.*)\)/.exec(line);
    if (!m) continue;
    map.set(m[1], m[2] === "" ? [] : m[2].split(","));
  }
  console.log(`  ${map.size} decomposition records`);
  return map;
};

/** One word's priority signals, derived from its JMdict `ke_pri`/`re_pri` tags. */
export interface WordPriority {
  /**
   * The wordfreq rank bucket: 1 = the 500 most frequent words, 2 = the next 500, … Lower is more
   * frequent. `null` when the entry carries no nfXX tag (i.e. outside wordfreq's top ~24,000).
   */
  freqRank: number | null;
  /** The raw priority tags (news1, ichi1, spec1, gai1…), kept for display badges and tag search. */
  tags: string[];
}

/**
 * Stream JMdict's XML and extract each entry's priority tags, keyed by `ent_seq` — which IS our
 * `words.id`, so this joins as an exact primary key rather than a lossy surface+reading match (the
 * same property that made the JLPT list a good source).
 *
 * Hand-parsed rather than via an XML library: we need two fields out of a 60MB document, and the
 * structure we depend on is trivially regular (`<ent_seq>` once per entry, `<ke_pri>`/`<re_pri>`
 * repeated). Streaming keeps peak memory flat — we never hold the whole document.
 *
 * A word's tags are the UNION across its writings/readings, and its rank is the BEST (lowest) nfXX
 * among them. JMdict tags priorities per kanji/reading pair because a priority sometimes applies to
 * only one pair; we rank whole entries, so the entry is as common as its most common form.
 */
const fetchWordPriorities = async (): Promise<Map<string, WordPriority>> => {
  console.log("Downloading JMdict_e.gz (priority tags)…");
  const res = await fetch(JMDICT_XML_URL, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok) throw new Error(`JMdict XML → ${res.status} ${res.statusText}`);

  const byId = new Map<string, WordPriority>();
  const gunzip = createGunzip();

  // Accumulate decompressed text and consume it one <entry> at a time, so the buffer never grows
  // past a single entry regardless of the document's size.
  let buffer = "";
  gunzip.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let end: number;
    while ((end = buffer.indexOf("</entry>")) !== -1) {
      const entry = buffer.slice(0, end);
      buffer = buffer.slice(end + 8);

      const seq = /<ent_seq>(\d+)<\/ent_seq>/.exec(entry)?.[1];
      if (seq === undefined) continue;

      const tags = [
        ...entry.matchAll(/<(?:ke|re)_pri>([^<]+)<\/(?:ke|re)_pri>/g)
      ]
        .map((m) => m[1])
        .filter((t) => t !== "");
      if (tags.length === 0) continue;

      // Best (lowest) nfXX across the entry's writings/readings.
      let freqRank: number | null = null;
      const named: string[] = [];
      for (const tag of tags) {
        const nf = /^nf(\d+)$/.exec(tag);
        if (nf) {
          const rank = Number(nf[1]);
          if (freqRank === null || rank < freqRank) freqRank = rank;
        } else if (!named.includes(tag)) {
          named.push(tag);
        }
      }
      byId.set(seq, { freqRank, tags: named });
    }
  });

  if (!res.body) throw new Error("JMdict XML response had no body");
  // Feed the gunzip by iterating fetch's stream directly. `Readable.fromWeb` would be the tidier
  // bridge, but the DOM and Node lib both declare a `ReadableStream` and they aren't assignable to
  // each other here; async iteration sidesteps the clash without a cast.
  for await (const chunk of res.body) gunzip.write(chunk);
  gunzip.end();
  await finished(gunzip);
  console.log(`  priority tags for ${byId.size} entries`);
  return byId;
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
  priority: Map<string, WordPriority>;
  /** char → its direct component children (cjk-decomp, unpruned). */
  decomp: Map<string, string[]>;
}

const downloadSources = async (): Promise<Sources> => {
  console.log("Resolving latest jmdict-simplified release…");
  const release = await fetchJson<GithubRelease>(RELEASE_API);
  console.log(`Release ${release.tag_name}`);
  const [dict, kanjidic, kradfile, radkfile, jlpt, pitch, priority, decomp] =
    await Promise.all([
      fetchAssetJson<JMdict>(release, ASSET_PATTERN),
      fetchAssetJson<Kanjidic2>(release, KANJIDIC_PATTERN),
      fetchAssetJson<Kradfile>(release, KRADFILE_PATTERN),
      fetchAssetJson<Radkfile>(release, RADKFILE_PATTERN),
      fetchJlptLevels(),
      fetchPitchAccents(),
      fetchWordPriorities(),
      fetchDecomposition()
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
  return { dict, kanjidic, kradfile, radkfile, jlpt, pitch, priority, decomp };
};

const buildDatabase = async (sources: Sources): Promise<void> => {
  const { dict, kanjidic, kradfile, radkfile, jlpt, pitch, priority, decomp } =
    sources;
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
    "INSERT INTO words(id, is_common, freq_rank, priority_tags_json) VALUES (?, ?, ?, ?)"
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
    "INSERT INTO search_terms(word_id, kind, term, term_lower, is_common, is_primary, sense_breadth) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insKanjiChar = await db.prepare(
    `INSERT INTO kanji_characters(literal, grade, stroke_count, frequency, jlpt,
       on_json, kun_json, meanings_json, nanori_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insComponent = await db.prepare(
    "INSERT INTO kanji_components(literal, component) VALUES (?, ?)"
  );
  const insTreeEdge = await db.prepare(
    "INSERT INTO component_tree(literal, child, position) VALUES (?, ?, ?)"
  );
  const insRadical = await db.prepare(
    "INSERT INTO radicals(radical, stroke_count, kanji_json) VALUES (?, ?, ?)"
  );
  const insStrokeSvg = await db.prepare(
    "INSERT INTO stroke_svgs(literal, svg) VALUES (?, ?)"
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
      insSentence,
      priority
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

  // Recursive component tree (cjk-decomp), pruned to Kanjidic nodes. cjk-decomp recurses to stroke
  // primitives and PUA glyphs; we only want children that are themselves characters we have a detail
  // page (and meanings) for — so for each kanji, gather the NEAREST such descendants along each
  // branch. When a direct child isn't in Kanjidic (a stroke shape), we descend THROUGH it to find
  // the real components beneath, which is what collapses cjk-decomp's deep stroke tree onto the
  // clean kanji-level hierarchy the UI shows. A child that IS a kanji becomes an edge and the walk
  // stops there (its own row carries its subtree — the tree is reconstructed by following edges).
  const treeEdgesFor = (literal: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([literal]);
    const collect = (node: string): void => {
      for (const child of decomp.get(node) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        if (kanjiSet.has(child)) {
          out.push(child); // a real component — an edge; its own subtree lives in its own rows
        } else {
          collect(child); // a stroke shape / PUA — descend through it to the real parts below
        }
      }
    };
    collect(literal);
    return out;
  };
  for (const literal of kanjiSet) {
    const children = treeEdgesFor(literal);
    // Skip self-referential singletons (a kanji whose only "component" is itself): no tree to show.
    if (
      children.length === 0 ||
      (children.length === 1 && children[0] === literal)
    ) {
      continue;
    }
    let position = 0;
    for (const child of children) {
      await insTreeEdge.run(literal, child, position);
      position++;
    }
  }
  // Radkfile radicals.
  for (const [radical, info] of Object.entries(radkfile.radicals)) {
    await insRadical.run(radical, info.strokeCount, JSON.stringify(info.kanji));
  }
  await db.exec("COMMIT");
  console.log(`  kanji: ${kanjiSet.size} characters`);

  // ── Stroke-order SVG pass (AnimCJK) ───────────────────────────────────────
  // Ingest each vendored per-character SVG verbatim (file named by literal, e.g. 食.svg). Kept as
  // its own batched transaction; each SVG is a few KB of text.
  await db.exec("BEGIN");
  let svgRows = 0;
  if (existsSync(STROKE_SVG_DIR)) {
    let sdone = 0;
    for (const file of readdirSync(STROKE_SVG_DIR)) {
      if (!file.endsWith(".svg")) continue; // skip the license/README files
      const literal = file.slice(0, -".svg".length);
      const svg = readFileSync(join(STROKE_SVG_DIR, file), "utf8");
      await insStrokeSvg.run(literal, svg);
      svgRows++;
      if (++sdone % BATCH === 0) {
        await db.exec("COMMIT");
        await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        await db.exec("BEGIN");
      }
    }
  }
  await db.exec("COMMIT");
  console.log(`  stroke SVGs: ${svgRows} characters`);

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
    "strokeSource",
    "Stroke order: AnimCJK (© FM&SH), glyph paths under the Arphic Public License"
  );
  await insMeta.run("strokeSvgCount", String(svgRows));
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
  /** JMdict-id → priority tags, from the original XML (jmdict-simplified drops them). */
  priority: Map<string, WordPriority>;
}

/** Cap on example sentences kept per sense — the source averages ~1, but bound it defensively. */
const MAX_SENTENCES_PER_SENSE = 3;

/** Imports one word; returns the number of example sentences inserted for it. */
const importWord = async (word: JMdictWord, s: Stmts): Promise<number> => {
  const wordCommon =
    word.kanji.some((k) => k.common) || word.kana.some((k) => k.common) ? 1 : 0;
  // JMdict's own priority data, joined by entry id. Absent for most entries (nfXX only covers the
  // top ~24k words), which is why freq_rank is nullable and ranking must not assume it.
  const pri = s.priority.get(word.id);
  await s.insWord.run(
    word.id,
    wordCommon,
    pri?.freqRank ?? null,
    JSON.stringify(pri?.tags ?? [])
  );
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
      i === 0 ? 1 : 0,
      1 // a writing stands alone; sense_breadth only means anything for gloss rows
    );
    // Index each distinct CJK character of the writing so a single-kanji query (強) finds words
    // containing it (勉強) via an *exact* char-row match — substring LIKE scans are too slow at
    // full-dictionary scale, so containment is precomputed here instead.
    for (const char of new Set(k.text)) {
      if (/[㐀-鿿豈-﫿]/.test(char)) {
        await s.insTerm.run(
          word.id,
          "char",
          char,
          char,
          k.common ? 1 : 0,
          0,
          1
        );
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
      i === 0 ? 1 : 0,
      1
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
        i === 0 ? 1 : 0,
        1
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
    // How many glosses this sense carries — a specificity signal for ranking. "to eat" alone
    // (食べる) is a much stronger match for "eat" than "to eat, to drink, to smoke, to take"
    // (喫する), where it's one of four near-synonyms. See schema.sql's sense_breadth.
    const breadth = sense.gloss.length;
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
        isPrimary,
        breadth
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
          isPrimary,
          breadth
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
        await s.insTerm.run(
          word.id,
          "word",
          w,
          w,
          wordCommon,
          isPrimary,
          breadth
        );
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

/**
 * Build the separate JMnedict names database. Mirrors the word build's discipline (batched
 * commits + WAL checkpoints, denormalized index-friendly search terms) but with the simpler name
 * schema. Emits `jisho-names.db` and always the gzip trio (it's a download-only artifact — there's
 * no bundled dev copy the way the common word DB has).
 */
const buildNamesDatabase = async (): Promise<void> => {
  console.log("Resolving latest jmdict-simplified release…");
  const release = await fetchJson<GithubRelease>(RELEASE_API);
  console.log(`Release ${release.tag_name}`);
  const dict = await fetchAssetJson<JMnedict>(release, NAMES_ASSET_PATTERN);

  mkdirSync(dirname(NAMES_DB), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${NAMES_DB}${suffix}`, { force: true });
  }

  const db = await connect(NAMES_DB);
  await db.exec(readFileSync(NAMES_SCHEMA, "utf8"));
  await db.exec("PRAGMA synchronous=OFF");
  await db.exec("BEGIN");

  const insTag = await db.prepare(
    "INSERT INTO name_tags(tag, description) VALUES (?, ?)"
  );
  for (const [tag, description] of Object.entries(dict.tags)) {
    await insTag.run(tag, description);
  }

  const insWord = await db.prepare("INSERT INTO name_words(id) VALUES (?)");
  const insKanji = await db.prepare(
    "INSERT INTO name_kanji(word_id, position, text) VALUES (?, ?, ?)"
  );
  const insKana = await db.prepare(
    "INSERT INTO name_kana(word_id, position, text, applies_to_kanji_json) VALUES (?, ?, ?, ?)"
  );
  const insTrans = await db.prepare(
    "INSERT INTO name_translations(word_id, position, types_json, translations_json) VALUES (?, ?, ?, ?)"
  );
  const insTerm = await db.prepare(
    "INSERT INTO name_search_terms(word_id, kind, term, term_lower, is_primary) VALUES (?, ?, ?, ?, ?)"
  );

  const BATCH = 5000;
  const total = dict.words.length;
  let done = 0;
  for (const name of dict.words) {
    await importName(name, { insWord, insKanji, insKana, insTrans, insTerm });
    if (++done % BATCH === 0) {
      await db.exec("COMMIT");
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      await db.exec("BEGIN");
      console.log(`  …${done}/${total} names`);
    }
  }
  await db.exec("COMMIT");

  const insMeta = await db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?)"
  );
  await insMeta.run("source", "JMnedict (jmdict-simplified, jmnedict-all)");
  await insMeta.run("dictDate", dict.dictDate);
  await insMeta.run("dictRevisions", dict.dictRevisions.join(", "));
  await insMeta.run(
    "license",
    "EDRDG License (https://www.edrdg.org/edrdg/licence.html)"
  );
  const builtAt = new Date().toISOString();
  await insMeta.run("variant", "names");
  await insMeta.run("nameCount", String(total));
  await insMeta.run("builtAt", builtAt);

  await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await db.close();

  const version = `names ${dict.dictDate} ${builtAt}`;
  writeFileSync(`${NAMES_DB}.version`, version, "utf8");
  console.log(`\nWrote ${NAMES_DB} — ${total} names.`);

  // Names ship only as a download (no bundled dev copy), so always emit the gzip trio.
  console.log("Compressing release asset…");
  const gzPath = join(dirname(NAMES_DB), "jisho-names.db.gz");
  await pipeline(
    createReadStream(NAMES_DB),
    createGzip({ level: 9 }),
    createWriteStream(gzPath)
  );
  const hash = createHash("sha256");
  await pipeline(createReadStream(gzPath), hash);
  writeFileSync(`${gzPath}.sha256`, hash.digest("hex"), "utf8");
  writeFileSync(`${gzPath}.version`, version, "utf8");
  console.log(`Wrote ${gzPath} (+ .sha256, .version)`);
};

interface NameStmts {
  insWord: Statement;
  insKanji: Statement;
  insKana: Statement;
  insTrans: Statement;
  insTerm: Statement;
}

const importName = async (name: JMnedictWord, s: NameStmts): Promise<void> => {
  await s.insWord.run(name.id);

  for (let i = 0; i < name.kanji.length; i++) {
    const k = name.kanji[i];
    await s.insKanji.run(name.id, i, k.text);
    await s.insTerm.run(
      name.id,
      "kanji",
      k.text,
      k.text.toLowerCase(),
      i === 0 ? 1 : 0
    );
  }
  for (let i = 0; i < name.kana.length; i++) {
    const k = name.kana[i];
    await s.insKana.run(name.id, i, k.text, JSON.stringify(k.appliesToKanji));
    await s.insTerm.run(
      name.id,
      "kana",
      k.text,
      k.text.toLowerCase(),
      i === 0 ? 1 : 0
    );
    const romaji = toRomaji(k.text);
    if (romaji !== "" && romaji !== k.text) {
      await s.insTerm.run(name.id, "romaji", romaji, romaji.toLowerCase(), 0);
    }
  }
  for (let i = 0; i < name.translation.length; i++) {
    const t = name.translation[i];
    const texts = t.translation.map((tt) => tt.text);
    await s.insTrans.run(
      name.id,
      i,
      JSON.stringify(t.type),
      JSON.stringify(texts)
    );
    // Index each word of each translation so an English query ("Tanaka") finds the name.
    const words = new Set(
      texts
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((w) => w.length > 1)
    );
    for (const w of words) {
      await s.insTerm.run(name.id, "trans", w, w, 0);
    }
  }
};

console.time("build-data");
if (NAMES) {
  await buildNamesDatabase();
} else {
  const sources = await downloadSources();
  await buildDatabase(sources);
}
console.timeEnd("build-data");
