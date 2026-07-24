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
import {
  constants as zlibConstants,
  createGunzip,
  createZstdCompress,
  gunzipSync
} from "node:zlib";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { finished, pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "@tursodatabase/database";
import { toHiragana, toRomaji } from "wanakana";
import bz2 from "unbzip2-stream";
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
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from "../src/shared/schema.ts";
// Build-local furigana: the host's addFuriganaToLine pulls in hover.ts → shared/grammar, whose own
// imports don't all resolve under `vp exec node`, but the two primitives it needs DO — so annotate
// example sentences here with just the tokenizer + ruby renderer. Relative TS imports need explicit
// `.ts` extensions: `vp exec node` runs the .ts directly (Node type-stripping) with no extension
// rewriting, so extensionless specifiers fail to resolve here (unlike inside the bundled extension).
import { segment } from "../src/host/tokenizer.ts";
import { toRubyMarkdown } from "../src/shared/ruby.ts";

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
const RELEASE_API =
  "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

// `--names` builds the separate JMnedict names database (`jisho-names.db`), an optional download
// delivered as its own `jisho-names.db.zst` trio on the dictionary-latest release. It's ~743k
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

// Release assets are zstd-compressed (measured ~29% smaller than gzip -9, and faster to decompress).
// Node 26 ships zstd in node:zlib, so both this build and the host downloader use the built-in — no
// runtime dependency. `download.ts` must decompress with the matching `.zst` convention.
const ZSTD_LEVEL = 19;

/**
 * Compress the DB at `srcPath` to `<assetBase>.zst`, then write its `.sha256` (of the compressed
 * bytes, which is what the downloader verifies as it streams) and `.version` siblings. `assetBase` is
 * the release-asset name (e.g. `…/jisho-full.db`), which differs from the on-disk `srcPath` for the
 * word DB (built as `jisho.db`, shipped as `jisho-full.db`). Returns the `.zst` path.
 */
const writeReleaseAsset = async (
  srcPath: string,
  assetBase: string,
  version: string
): Promise<string> => {
  const zstPath = `${assetBase}.zst`;
  await pipeline(
    createReadStream(srcPath),
    createZstdCompress({
      params: { [zlibConstants.ZSTD_c_compressionLevel]: ZSTD_LEVEL }
    }),
    createWriteStream(zstPath)
  );
  const hash = createHash("sha256");
  await pipeline(createReadStream(zstPath), hash);
  writeFileSync(`${zstPath}.sha256`, hash.digest("hex"), "utf8");
  writeFileSync(`${zstPath}.version`, version, "utf8");
  return zstPath;
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

// Tatoeba example-sentence corpus (CC-BY 2.0 FR — same licence and project as the Tanaka examples we
// already ship, so no new licensing surface). The jmdict-examples-eng set is only Jim Breen's curated
// Tanaka SUBSET (~1 sentence/sense); Jisho.org shows more because it links the fuller Tatoeba corpus by
// word. We import that here to populate a word-level "more examples" pool (F1).
//
// Three per-language exports, joined at build time (all rolling weekly; pinned only by their
// last-modified date, recorded in `meta`):
//   jpn_indices  — the word-index: one row per Japanese sentence, `sentence_id ⇥ meaning_id ⇥ B-line`.
//                  The B-line lists the dictionary head-words the sentence contains (see BLINE_TOKEN).
//   jpn_sentences — `id ⇥ jpn ⇥ text`: the Japanese sentence text, looked up by the index's sentence_id.
//   eng_sentences — `id ⇥ eng ⇥ text`: English text, looked up by the index's meaning_id (which IS an
//                  English sentence id; ~98% resolve). Gives each example its translation.
const TATOEBA_BASE = "https://downloads.tatoeba.org/exports";
const TATOEBA_JPN_INDICES_URL = `${TATOEBA_BASE}/jpn_indices.tar.bz2`;
const TATOEBA_JPN_SENTENCES_URL = `${TATOEBA_BASE}/per_language/jpn/jpn_sentences.tsv.bz2`;
const TATOEBA_ENG_SENTENCES_URL = `${TATOEBA_BASE}/per_language/eng/eng_sentences.tsv.bz2`;

// One head-word token in a B-line: `headword(reading)[NN]{surface}~`, all but the headword optional.
//   headword   — the dictionary form (kanji or kana) we resolve to a words.id.
//   (reading)  — disambiguates homographs to the right entry.
//   [NN]       — 1-based zero-padded SENSE number (present on ~20% of tokens); attaches the sentence
//                to that specific sense when it resolves in-range, else the word-level pool (-1).
//   {surface}  — the form as written in the sentence (unused for the pool; we store the whole sentence).
//   ~          — a "good/checked" marker (ignored).
const BLINE_TOKEN =
  /^(?<headword>[^([{~]+)(?:\((?<reading>[^)]*)\))?(?:\[(?<sense>\d+)\])?(?:\{[^}]*\})?~?/u;

// The word-level pool sense_position sentinel (mirrors the schema comment): a Tatoeba sentence whose
// B-line token carried no in-range [NN] sense tag is attached to the word, not a sense.
const WORD_LEVEL_SENSE = -1;
// Cap stored Tatoeba pool sentences per word, spread across its senses + the word-level bucket.
const MAX_POOL_SENTENCES_PER_WORD = 20;

// Similar-kanji data (F3): Lars Yencken's kanji-confusion datasets, CC BY 3.0. Human-validated
// PhD research on which kanji people actually confuse — far better than raw component overlap, which
// misses atomic confusables (大/太/犬, 日/白) and is noisy on shared-radical compounds. Two precomputed
// nearest-neighbour tables over the 1,945 jōyō kanji, blended; the component heuristic fills in kanji
// beyond jōyō. Each file: space-separated `pivot n1 score1 n2 score2 …` (10 neighbours, score in
// [0,1], higher = more similar). https://lars.yencken.org/datasets/kanji-confusion/
const YENCKEN_BASE = "https://lars.yencken.org/datasets/kanji-confusion";
const YENCKEN_STROKE_URL = `${YENCKEN_BASE}/jyouyou__strokeEditDistance.csv`;
const YENCKEN_RADICAL_URL = `${YENCKEN_BASE}/jyouyou__yehAndLiRadical.csv`;

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

// ── Tatoeba example-sentence pool (F1) ─────────────────────────────────────────

/** Download a `.bz2` URL and return its decompressed bytes, plus the `Last-Modified` header. */
const fetchBz2 = async (
  url: string
): Promise<{ data: Buffer; lastModified: string }> => {
  const res = await fetch(url, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok || res.body === null) {
    throw new Error(`Tatoeba ${url} → ${res.status} ${res.statusText}`);
  }
  const lastModified = res.headers.get("last-modified") ?? "";
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done): void {
      chunks.push(chunk);
      done();
    }
  });
  // Readable.from accepts the fetch body's web stream directly (same trick as download.ts).
  await pipeline(Readable.from(res.body), bz2(), sink);
  return { data: Buffer.concat(chunks), lastModified };
};

/** Extract the single-member `.tar` produced by decompressing a `.tar.bz2` (one regular file). */
const singleTarMember = (tar: Buffer): string => {
  // Same 512-byte-record tar layout as extractSingleJsonFromTgz, but returns the first regular file's
  // content whatever its extension (the Tatoeba archive holds one .csv).
  const name = decodeCString(tar.subarray(0, 100));
  if (name === "") throw new Error("Empty tar archive");
  const size = parseInt(decodeCString(tar.subarray(124, 136)), 8) || 0;
  return tar.subarray(512, 512 + size).toString("utf8");
};

/** A parsed Tatoeba example: the sentence text pair plus its resolved (word_id, sense) targets. */
interface TatoebaExample {
  tatoebaId: number;
  ja: string;
  en: string;
  /** Head-word tokens found in the sentence: the dictionary form and its optional 1-based sense. */
  tokens: Array<{ headword: string; reading?: string; sense?: number }>;
}

/**
 * Download and join the three Tatoeba exports into example rows. Each row is a Japanese sentence with
 * its English translation and the list of head-word tokens (from the B-line) it contains — the raw
 * material the import pass resolves against `words.id`. Word resolution and the per-word cap happen
 * later (they need the built `words` rows); this only parses.
 */
const fetchTatoeba = async (): Promise<{
  examples: TatoebaExample[];
  dates: { indices: string; jpn: string; eng: string };
}> => {
  console.log("Downloading Tatoeba exports (jpn_indices, jpn/eng sentences)…");
  const [indices, jpn, eng] = await Promise.all([
    fetchBz2(TATOEBA_JPN_INDICES_URL),
    fetchBz2(TATOEBA_JPN_SENTENCES_URL),
    fetchBz2(TATOEBA_ENG_SENTENCES_URL)
  ]);

  // id → text maps for the two sentence exports (`id ⇥ lang ⇥ text`).
  const textById = (buf: Buffer): Map<string, string> => {
    const map = new Map<string, string>();
    for (const line of buf.toString("utf8").split("\n")) {
      if (line === "") continue;
      const tab1 = line.indexOf("\t");
      const tab2 = line.indexOf("\t", tab1 + 1);
      if (tab1 === -1 || tab2 === -1) continue;
      map.set(line.slice(0, tab1), line.slice(tab2 + 1));
    }
    return map;
  };
  const jaById = textById(jpn.data);
  const enById = textById(eng.data);

  const examples: TatoebaExample[] = [];
  const csv = singleTarMember(indices.data);
  for (const line of csv.split("\n")) {
    if (line === "") continue;
    // `sentence_id ⇥ meaning_id ⇥ B-line`; a malformed row with fewer fields is skipped.
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [sentenceId, meaningId, bline] = parts;
    const ja = jaById.get(sentenceId);
    const en = enById.get(meaningId);
    // Need both a Japanese sentence and an English translation to show a useful example.
    if (ja === undefined || en === undefined) continue;

    const tokens: TatoebaExample["tokens"] = [];
    for (const raw of bline.split(/\s+/)) {
      if (raw === "") continue;
      const g = BLINE_TOKEN.exec(raw)?.groups;
      if (!g?.headword) continue;
      // Named groups are typed `string` but are optional at runtime; coerce the sense, leave the
      // rest as-is (empty/absent reading is handled by the resolver).
      tokens.push({
        headword: g.headword,
        reading: g.reading || undefined,
        sense: g.sense ? Number(g.sense) : undefined
      });
    }
    if (tokens.length === 0) continue;
    examples.push({ tatoebaId: Number(sentenceId), ja, en, tokens });
  }

  console.log(
    `  ${examples.length} indexed sentences (of ${csv.split("\n").length - 1} index rows)`
  );
  return {
    examples,
    dates: {
      indices: indices.lastModified,
      jpn: jpn.lastModified,
      eng: eng.lastModified
    }
  };
};

const HAS_KANJI = /[㐀-鿿豈-﫿]/u;

/**
 * Annotate a Japanese sentence with mirrordown ruby ({漢字|かんじ}) at build time, so the DB stores
 * the furigana and the webview renders it with no runtime tokenizer cost. A build-local reimplementation
 * of the host's addFuriganaToLine using only the tokenizer + ruby renderer (its full version drags in
 * the hover/grammar module tree, which doesn't resolve under `vp exec node`). Each kanji-bearing
 * segment with a reading is wrapped; everything else passes through unchanged.
 */
const annotateFurigana = async (ja: string): Promise<string> => {
  const segments = await segment(ja);
  let out = "";
  for (const seg of segments) {
    if (HAS_KANJI.test(seg.surface) && seg.reading !== "") {
      out += toRubyMarkdown(seg.surface, toHiragana(seg.reading));
    } else {
      out += seg.surface;
    }
  }
  return out;
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
  /** Tatoeba example pool + the exports' last-modified dates (F1). */
  tatoeba: Awaited<ReturnType<typeof fetchTatoeba>>;
  /** Yencken similar-kanji tables (stroke-edit + Yeh-Li radical) + their dates (F3). */
  yencken: {
    stroke: Awaited<ReturnType<typeof fetchYencken>>;
    radical: Awaited<ReturnType<typeof fetchYencken>>;
  };
}

const downloadSources = async (): Promise<Sources> => {
  console.log("Resolving latest jmdict-simplified release…");
  const release = await fetchJson<GithubRelease>(RELEASE_API);
  console.log(`Release ${release.tag_name}`);
  const [
    dict,
    kanjidic,
    kradfile,
    radkfile,
    jlpt,
    pitch,
    priority,
    decomp,
    tatoeba,
    yenckenStroke,
    yenckenRadical
  ] = await Promise.all([
    fetchAssetJson<JMdict>(release, ASSET_PATTERN),
    fetchAssetJson<Kanjidic2>(release, KANJIDIC_PATTERN),
    fetchAssetJson<Kradfile>(release, KRADFILE_PATTERN),
    fetchAssetJson<Radkfile>(release, RADKFILE_PATTERN),
    fetchJlptLevels(),
    fetchPitchAccents(),
    fetchWordPriorities(),
    fetchDecomposition(),
    fetchTatoeba(),
    fetchYencken(YENCKEN_STROKE_URL),
    fetchYencken(YENCKEN_RADICAL_URL)
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
  return {
    dict,
    kanjidic,
    kradfile,
    radkfile,
    jlpt,
    pitch,
    priority,
    decomp,
    tatoeba,
    yencken: { stroke: yenckenStroke, radical: yenckenRadical }
  };
};

const buildDatabase = async (sources: Sources): Promise<void> => {
  const {
    dict,
    kanjidic,
    kradfile,
    radkfile,
    jlpt,
    pitch,
    priority,
    decomp,
    tatoeba,
    yencken
  } = sources;
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
    `INSERT INTO sentences(word_id, sense_position, position, ja, ja_furigana, en, tatoeba_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
  const insSimilar = await db.prepare(
    "INSERT INTO similar_kanji(literal, similar, position) VALUES (?, ?, ?)"
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

  // Similar kanji (F3): PRIMARY source is Yencken's human-validated confusion data (stroke-edit +
  // Yeh-Li radical, blended), which covers the 1,945 jōyō kanji well. For kanji BEYOND jōyō it has no
  // rows, so the weighted Kradfile-component heuristic fills those gaps. Both restrict candidates to
  // kanji we have a character row for (FK safety).
  const yenckenSimilar = blendYencken(
    yencken.stroke.rows,
    yencken.radical.rows,
    kanjiSet
  );

  const strokesByLiteral = new Map<string, number | null>();
  for (const char of kanjidic.characters) {
    strokesByLiteral.set(char.literal, char.misc.strokeCounts[0] ?? null);
  }
  const kanjiFeatures = new Map<string, KanjiFeatures>();
  for (const [literal, components] of Object.entries(kradfile.kanji)) {
    if (!kanjiSet.has(literal)) continue;
    // Only components that are themselves in our kanji set stay comparable, and self-components are
    // dropped (a kanji is not its own part).
    const comps = new Set(components.filter((c) => c !== literal));
    kanjiFeatures.set(literal, {
      components: comps,
      strokes: strokesByLiteral.get(literal) ?? null
    });
  }
  const heuristicSimilar = computeSimilarKanji(kanjiFeatures);

  let similarRows = 0;
  let yenckenCovered = 0;
  for (const literal of kanjiSet) {
    // Yencken where available (better quality), the component heuristic otherwise.
    const fromYencken = yenckenSimilar.get(literal);
    const list = fromYencken ?? heuristicSimilar.get(literal);
    if (!list) continue;
    if (fromYencken) yenckenCovered++;
    let position = 0;
    for (const s of list) {
      await insSimilar.run(literal, s, position);
      position++;
      similarRows++;
    }
  }
  await db.exec("COMMIT");
  console.log(`  kanji: ${kanjiSet.size} characters`);
  console.log(
    `  similar: ${similarRows} rows (${yenckenCovered} kanji from Yencken, rest from the component heuristic)`
  );

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

  // ── Tatoeba example pool pass (F1) ──────────────────────────────────────────
  // Attach the fuller Tatoeba corpus to words as a "more examples" pool (source='tatoeba'), on top of
  // the inline per-sense Tanaka examples (source='tanaka'). Resolution is a build-time join of the
  // B-line head-word tokens against the words we just imported — the runtime read is a plain lookup.
  //
  // A token resolves via, in order: exact (kanji writing + kana reading) → kanji writing alone →
  // kana reading alone. A [NN] sense tag that is in range attaches the sentence to that sense
  // (0-based sense_position); otherwise it lands in the word-level bucket (sense_position = -1).
  const tatoebaRows = await importTatoebaPool(db, dict, tatoeba.examples, {
    insSentence
  });
  console.log(`  tatoeba: ${tatoebaRows} pool sentence rows`);

  // Attribution / provenance.
  const insMeta = await db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?)"
  );
  // The schema version the host verifies on open (see src/shared/schema.ts). Stamped first so it is
  // present even if a later meta insert fails.
  await insMeta.run(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION));
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
  await insMeta.run("similarKanjiRows", String(similarRows));
  await insMeta.run(
    "similarKanjiSource",
    "Similar kanji: Lars Yencken's kanji-confusion data (stroke-edit + Yeh-Li radical distance) for jōyō, with a Kradfile-component heuristic filling in the rest"
  );
  await insMeta.run(
    "similarKanjiLicense",
    "CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) — Lars Yencken, https://lars.yencken.org/datasets/kanji-confusion/"
  );
  await insMeta.run("similarKanjiStrokeDate", yencken.stroke.lastModified);
  await insMeta.run("similarKanjiRadicalDate", yencken.radical.lastModified);
  await insMeta.run(
    "strokeSource",
    "Stroke order: AnimCJK (© FM&SH), glyph paths under the Arphic Public License"
  );
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
    "Example sentences: Tanaka corpus (inline, via jmdict-examples-eng) + the fuller Tatoeba corpus (more-examples pool)"
  );
  await insMeta.run(
    "sentenceLicense",
    "CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/deed.en)"
  );
  await insMeta.run("sentenceRows", String(sentenceRows));
  await insMeta.run("tatoebaPoolRows", String(tatoebaRows));
  // The exports are rolling weekly; their last-modified dates are the closest thing to a version.
  await insMeta.run("tatoebaIndicesDate", tatoeba.dates.indices);
  await insMeta.run("tatoebaJpnDate", tatoeba.dates.jpn);
  await insMeta.run("tatoebaEngDate", tatoeba.dates.eng);
  console.log(
    `  sentences: ${sentenceRows} inline + ${tatoebaRows} pool example rows`
  );
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

  // The full variant is delivered via the dictionary-latest GitHub Release: emit the zstd-compressed
  // asset, its sha256, and the version string the downloader compares against its sidecar.
  if (FULL) {
    console.log("Compressing release asset…");
    const zstPath = await writeReleaseAsset(
      OUT_DB,
      join(dirname(OUT_DB), "jisho-full.db"),
      version
    );
    console.log(`Wrote ${zstPath} (+ .sha256, .version)`);
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

/** Cap on inline (Tanaka) example sentences kept per sense — the source averages ~1, bound defensively. */
const MAX_SENTENCES_PER_SENSE = 3;

/**
 * Position offset for Tatoeba POOL rows that attach to a real sense. The sentences PK is
 * (word_id, sense_position, position) and does not include `source`, so a pool row landing on the
 * same sense as an inline Tanaka row must not reuse its low positions (0..MAX_SENTENCES_PER_SENSE-1).
 * Starting pool positions here keeps the two sources' rows in the same sense from colliding; the
 * word-level bucket (sense_position = -1) never collides because inline rows never use it.
 */
const POOL_POSITION_BASE = MAX_SENTENCES_PER_SENSE;

/** Commit + WAL-checkpoint every N rows so the write-ahead log can't balloon during the bulk build. */
const BATCH = 5000;

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

    // Inline example sentences (source='tanaka', from jmdict-examples-eng): the curated per-sense
    // set, ~1/sense. Keep up to MAX per sense, each a ja/en pair; skip any missing either language
    // (the source is occasionally one-sided). `source.value` is the Tatoeba sentence id, kept so the
    // later Tatoeba-pool pass can dedup a pool sentence against the one already shown for this sense.
    const examples = (sense as SenseWithExamples).examples ?? [];
    let kept = 0;
    for (const ex of examples) {
      if (kept >= MAX_SENTENCES_PER_SENSE) break;
      const ja = ex.sentences.find((se) => se.lang === "jpn")?.text;
      const en = ex.sentences.find((se) => se.lang === "eng")?.text;
      if (ja === undefined || en === undefined) continue;
      const tatoebaId = Number(ex.source.value);
      await s.insSentence.run(
        word.id,
        i,
        kept,
        ja,
        await annotateFurigana(ja),
        en,
        Number.isFinite(tatoebaId) ? tatoebaId : null,
        "tanaka"
      );
      kept++;
    }
    sentenceCount += kept;
  }
  return sentenceCount;
};

/** A resolvable JMdict entry: its id and how many senses it has (to range-check a B-line [NN] tag). */
interface WordRef {
  id: string;
  senseCount: number;
}

/**
 * Build the head-word → entry lookup the Tatoeba pool resolves against. Keyed three ways so a B-line
 * token can be matched most-specific-first:
 *   `${kanji}\t${reading}` — an exact (writing, reading) pair (disambiguates homographs like 二十歳/はたち)
 *   `${kanji}`             — a kanji writing alone (when the token carries no reading)
 *   `${reading}`           — a kana reading alone (kana-only words, or reading-only tokens)
 * Each key maps to ALL entries that expose it (a surface can belong to several entries); the pool
 * sentence is attached to each, since it genuinely contains that word.
 */
const buildWordIndex = (
  dict: JMdict
): {
  byKanjiReading: Map<string, WordRef[]>;
  byKanji: Map<string, WordRef[]>;
  byReading: Map<string, WordRef[]>;
} => {
  const byKanjiReading = new Map<string, WordRef[]>();
  const byKanji = new Map<string, WordRef[]>();
  const byReading = new Map<string, WordRef[]>();
  const push = (
    map: Map<string, WordRef[]>,
    key: string,
    ref: WordRef
  ): void => {
    const list = map.get(key);
    if (list) list.push(ref);
    else map.set(key, [ref]);
  };
  for (const word of dict.words) {
    const ref: WordRef = { id: word.id, senseCount: word.sense.length };
    const readings = word.kana.map((k) => k.text);
    for (const reading of readings) push(byReading, reading, ref);
    for (const k of word.kanji) {
      push(byKanji, k.text, ref);
      for (const reading of readings) {
        push(byKanjiReading, `${k.text}\t${reading}`, ref);
      }
    }
  }
  return { byKanjiReading, byKanji, byReading };
};

interface PoolStmts {
  insSentence: Statement;
}

/**
 * Resolve every Tatoeba example's B-line tokens to entries and insert the results as the word-level
 * "more examples" pool. Per word we keep up to MAX_POOL_SENTENCES_PER_WORD sentences, deduped against
 * the inline Tanaka examples already stored for it (by Tatoeba id) so a sentence never shows twice.
 * Each stored sentence is furigana-annotated at build time. Returns the number of pool rows inserted.
 */
const importTatoebaPool = async (
  db: Awaited<ReturnType<typeof connect>>,
  dict: JMdict,
  examples: TatoebaExample[],
  s: PoolStmts
): Promise<number> => {
  const index = buildWordIndex(dict);

  // A pending pool sentence for one word: which sense (or -1), its Tatoeba id, and text.
  interface Pending {
    sensePosition: number;
    tatoebaId: number;
    ja: string;
    en: string;
  }
  // word_id → its candidate pool sentences (capped as we go). A Set of Tatoeba ids per word keeps the
  // pool internally unique (the same sentence can list a word twice, or two tokens hit one entry).
  const pending = new Map<string, Pending[]>();
  const seenIds = new Map<string, Set<number>>();

  const resolve = (token: TatoebaExample["tokens"][number]): WordRef[] => {
    if (token.reading !== undefined) {
      const exact = index.byKanjiReading.get(
        `${token.headword}\t${token.reading}`
      );
      if (exact) return exact;
    }
    return (
      index.byKanji.get(token.headword) ??
      index.byReading.get(token.headword) ??
      []
    );
  };

  for (const ex of examples) {
    // A sentence may list a word more than once (repeated token, or kanji+reading both resolving);
    // attach it at most once per word, at the most specific sense we saw for it.
    const targets = new Map<string, number>(); // word_id → chosen sense_position
    for (const token of ex.tokens) {
      for (const ref of resolve(token)) {
        const inRange =
          token.sense !== undefined &&
          token.sense >= 1 &&
          token.sense <= ref.senseCount;
        const sensePosition = inRange ? token.sense! - 1 : WORD_LEVEL_SENSE;
        // Keep the most specific (a real sense beats the word-level sentinel).
        const existing = targets.get(ref.id);
        if (existing === undefined || existing === WORD_LEVEL_SENSE) {
          targets.set(ref.id, sensePosition);
        }
      }
    }
    for (const [wordId, sensePosition] of targets) {
      let ids = seenIds.get(wordId);
      if (!ids) {
        ids = new Set();
        seenIds.set(wordId, ids);
      }
      if (ids.has(ex.tatoebaId)) continue;
      const list = pending.get(wordId) ?? [];
      if (list.length >= MAX_POOL_SENTENCES_PER_WORD) continue;
      ids.add(ex.tatoebaId);
      list.push({
        sensePosition,
        tatoebaId: ex.tatoebaId,
        ja: ex.ja,
        en: ex.en
      });
      pending.set(wordId, list);
    }
  }

  // Which inline (Tanaka) Tatoeba ids are already stored per word, so the pool doesn't repeat them.
  const inlineIds = await db.prepare(
    "SELECT tatoeba_id FROM sentences WHERE word_id = ? AND source = 'tanaka' AND tatoeba_id IS NOT NULL"
  );
  // The native binding types query rows as `any`; read the one column back through Number() rather
  // than asserting a row shape (which the linter rightly flags as unsafe).
  const readTatoebaId = (row: unknown): number => {
    if (typeof row === "object" && row !== null && "tatoeba_id" in row) {
      return Number((row as { tatoeba_id: unknown }).tatoeba_id);
    }
    return NaN;
  };
  const inlineIdsFor = async (wordId: string): Promise<Set<number>> => {
    const out = new Set<number>();
    const result: unknown = await inlineIds.all(wordId);
    if (Array.isArray(result)) {
      for (const row of result as unknown[]) {
        const id = readTatoebaId(row);
        if (Number.isFinite(id)) out.add(id);
      }
    }
    return out;
  };

  await db.exec("BEGIN");
  let rows = 0;
  let done = 0;
  for (const [wordId, list] of pending) {
    const already = await inlineIdsFor(wordId);
    // Stable position per (word, sense_position) group; the reader orders by it. Pool rows on a REAL
    // sense start at POOL_POSITION_BASE so they never reuse an inline Tanaka row's position (shared
    // PK, no `source` column in it); the word-level bucket (-1) has no inline rows to avoid.
    const positionBySense = new Map<number, number>();
    for (const p of list) {
      if (already.has(p.tatoebaId)) continue;
      const base =
        p.sensePosition === WORD_LEVEL_SENSE ? 0 : POOL_POSITION_BASE;
      const nth = positionBySense.get(p.sensePosition) ?? 0;
      positionBySense.set(p.sensePosition, nth + 1);
      await s.insSentence.run(
        wordId,
        p.sensePosition,
        base + nth,
        p.ja,
        await annotateFurigana(p.ja),
        p.en,
        p.tatoebaId,
        "tatoeba"
      );
      rows++;
    }
    if (++done % BATCH === 0) {
      await db.exec("COMMIT");
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      await db.exec("BEGIN");
    }
  }
  await db.exec("COMMIT");
  return rows;
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

/** How many similar kanji to keep per character (F3). */
const MAX_SIMILAR_KANJI = 6;
/** A candidate must clear this weighted-similarity floor to be kept (suppresses weak overlaps). */
const SIMILAR_KANJI_MIN_SCORE = 0.35;

/** Per-kanji features the similarity heuristic scores over. */
interface KanjiFeatures {
  components: Set<string>;
  strokes: number | null;
}

/**
 * Compute visually-similar kanji from shared Kradfile components (F3). Returns each kanji → its top
 * `MAX_SIMILAR_KANJI` look-alikes, ranked.
 *
 * Raw component overlap is noisy: 未 shares 木 with hundreds of kanji, most of which (魅, 藻…) look
 * nothing like it. Three signals cut that noise:
 *   1. IDF-weighted overlap — a shared component counts by its rarity (`log(N / df)`), so sharing a
 *      distinctive part matters far more than sharing 木/口/人. The overlap is normalised to a
 *      weighted Jaccard in [0,1] over the union of both kanji's components.
 *   2. Part-count closeness — look-alikes have a similar NUMBER of parts (未/末 differ by none; 未/魅
 *      differ by several). A growing gap multiplies the score down.
 *   3. Stroke-count closeness — genuine confusables are within a stroke or two (未 6 / 末 5).
 * A minimum-score floor drops candidates that merely brush the target. This is a deterministic,
 * offline approximation of curated confusable data, not a replacement for it.
 */
const computeSimilarKanji = (
  features: Map<string, KanjiFeatures>
): Map<string, string[]> => {
  const n = features.size;
  // Document frequency of each component across all kanji → its IDF weight.
  const df = new Map<string, number>();
  for (const { components } of features.values()) {
    for (const c of components) df.set(c, (df.get(c) ?? 0) + 1);
  }
  const idf = (c: string): number => Math.log(n / (df.get(c) ?? 1));

  // Inverted index component → kanji, so candidates are only those sharing ≥1 component.
  const kanjiWith = new Map<string, string[]>();
  for (const [literal, { components }] of features) {
    for (const c of components) {
      const list = kanjiWith.get(c);
      if (list) list.push(literal);
      else kanjiWith.set(c, [literal]);
    }
  }

  const result = new Map<string, string[]>();
  for (const [literal, feat] of features) {
    if (feat.components.size === 0) continue;
    const idfSelf = new Map<string, number>();
    let selfWeight = 0;
    for (const c of feat.components) {
      const w = idf(c);
      idfSelf.set(c, w);
      selfWeight += w;
    }

    // Gather candidates sharing any component (deduped), skipping the kanji itself.
    const candidates = new Set<string>();
    for (const c of feat.components) {
      for (const other of kanjiWith.get(c) ?? []) {
        if (other !== literal) candidates.add(other);
      }
    }

    const scored: Array<{ literal: string; score: number }> = [];
    for (const cand of candidates) {
      const cf = features.get(cand);
      if (!cf) continue;
      // IDF-weighted Jaccard: shared weight / union weight.
      let sharedWeight = 0;
      let unionWeight = selfWeight;
      for (const c of cf.components) {
        const w = idf(c);
        if (idfSelf.has(c)) sharedWeight += w;
        else unionWeight += w;
      }
      const jaccard = unionWeight > 0 ? sharedWeight / unionWeight : 0;

      // Part-count closeness: 1 when equal, decaying with the gap.
      const partGap = Math.abs(feat.components.size - cf.components.size);
      const partFactor = 1 / (1 + partGap);

      // Stroke closeness: 1 when equal, decaying; neutral (0.5) when either count is unknown.
      let strokeFactor = 0.5;
      if (feat.strokes !== null && cf.strokes !== null) {
        strokeFactor = 1 / (1 + Math.abs(feat.strokes - cf.strokes));
      }

      const score = jaccard * partFactor * strokeFactor;
      if (score >= SIMILAR_KANJI_MIN_SCORE)
        scored.push({ literal: cand, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, MAX_SIMILAR_KANJI).map((s) => s.literal);
    if (top.length > 0) result.set(literal, top);
  }
  return result;
};

/** One Yencken neighbour row parsed: the pivot kanji and its scored look-alikes. */
type YenckenRow = Map<string, Array<{ kanji: string; score: number }>>;

/** Fetch + parse a Yencken CSV (`pivot n1 score1 n2 score2 …`), returning pivot → scored neighbours. */
const fetchYencken = async (
  url: string
): Promise<{ rows: YenckenRow; lastModified: string }> => {
  const res = await fetch(url, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok)
    throw new Error(`Yencken ${url} → ${res.status} ${res.statusText}`);
  const lastModified = res.headers.get("last-modified") ?? "";
  const rows: YenckenRow = new Map();
  for (const line of (await res.text()).split("\n")) {
    const parts = line.split(" ").filter((p) => p !== "");
    if (parts.length < 3) continue;
    const [pivot, ...rest] = parts;
    const neighbours: Array<{ kanji: string; score: number }> = [];
    // rest is [kanji, score, kanji, score, …].
    for (let i = 0; i + 1 < rest.length; i += 2) {
      const score = Number(rest[i + 1]);
      if (Number.isFinite(score)) neighbours.push({ kanji: rest[i], score });
    }
    if (neighbours.length > 0) rows.set(pivot, neighbours);
  }
  return { rows, lastModified };
};

/**
 * Blend the two Yencken tables into a single ranked look-alike list per kanji. A neighbour's blended
 * score is the AVERAGE of its stroke-edit and radical scores where both tables list it, otherwise the
 * single score it has (already in [0,1]) — so a pair both metrics agree on outranks one only one saw.
 * Only neighbours that are kanji we actually have a character row for are kept (FK safety).
 */
const blendYencken = (
  stroke: YenckenRow,
  radical: YenckenRow,
  kanjiSet: Set<string>
): Map<string, string[]> => {
  const pivots = new Set([...stroke.keys(), ...radical.keys()]);
  const result = new Map<string, string[]>();
  for (const pivot of pivots) {
    if (!kanjiSet.has(pivot)) continue;
    const scores = new Map<string, { sum: number; count: number }>();
    for (const table of [stroke, radical]) {
      for (const { kanji, score } of table.get(pivot) ?? []) {
        if (!kanjiSet.has(kanji) || kanji === pivot) continue;
        const acc = scores.get(kanji) ?? { sum: 0, count: 0 };
        acc.sum += score;
        acc.count += 1;
        scores.set(kanji, acc);
      }
    }
    const ranked = [...scores.entries()]
      .map(([kanji, { sum, count }]) => ({ kanji, score: sum / count }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SIMILAR_KANJI)
      .map((r) => r.kanji);
    if (ranked.length > 0) result.set(pivot, ranked);
  }
  return result;
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

  // Names ship only as a download (no bundled dev copy), so always emit the zstd trio.
  console.log("Compressing release asset…");
  const zstPath = await writeReleaseAsset(NAMES_DB, NAMES_DB, version);
  console.log(`Wrote ${zstPath} (+ .sha256, .version)`);
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
