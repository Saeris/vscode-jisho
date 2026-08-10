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
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { finished, pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
import {
  SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  WORD_LEVEL_SENSE
} from "../src/shared/schema.ts";
// Build-local furigana: the host's addFuriganaToLine pulls in hover.ts → shared/grammar, whose own
// imports don't all resolve under `vp exec node`, but the two primitives it needs DO — so annotate
// example sentences here with just the tokenizer + ruby renderer. Relative TS imports need explicit
// `.ts` extensions: `vp exec node` runs the .ts directly (Node type-stripping) with no extension
// rewriting, so extensionless specifiers fail to resolve here (unlike inside the bundled extension).
import { segment } from "../src/host/tokenizer.ts";
import { toRubyMarkdown } from "../src/shared/ruby.ts";
import { linkToken, posToken } from "../src/shared/exampleLinks.ts";
import { CLASSIFIER_BY_ID } from "../src/shared/classifiers.ts";
import { searchFold, sortKey } from "../src/shared/kana.ts";
import { fetchAcjkMap, voteRadicalPositions } from "./acjk.ts";
import type { PartOfSpeech } from "../src/shared/messages.ts";

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
/**
 * Where a build WRITES, before it is promoted over the real path.
 *
 * The build takes ~10 minutes and used to write the destination directly, which fails outright on
 * Windows when anything holds the old DB open — a Wallaby worker running the DB-backed specs, or an
 * Extension Development Host, both of which are normal to have running while rebuilding. SQLite
 * readers keep the file (and its `-shm`) open, and Windows refuses to unlink an open file, so the
 * build died on its first line having done no work.
 *
 * Staging also means a reader never observes a half-built database: the swap is a single rename at
 * the end rather than ten minutes of visible partial state.
 */
const staged = (path: string): string => `${path}.building`;

/**
 * The build finished but the swap could not happen — the destination is still open.
 *
 * Distinct from every other build failure because the artifact is COMPLETE and valid: discarding it
 * would throw away the ten minutes that produced it over a file lock that costs seconds to clear.
 * The top-level handler keeps the staging file when it sees this.
 */
class PromoteBlocked extends Error {
  override name = "PromoteBlocked";
}

/**
 * Move a finished staging database over the path it ships at.
 *
 * `renameSync` onto an existing file is atomic on POSIX but fails on Windows if the destination is
 * open, so the destination is unlinked first — and if THAT fails the swap stops before anything has
 * been dismantled, leaving the finished build intact to promote later. The window between unlink and
 * rename is the only moment a reader can miss the file, versus the ten minutes of partial state that
 * writing in place exposed.
 */
const promote = (path: string): void => {
  const from = staged(path);
  // Remove the DESTINATION's files first, and treat any failure as "still locked" before touching
  // anything else. Deleting the staging sidecars up front would mean a lock left the build with
  // both a half-dismantled destination and a mutilated staging copy — the one outcome worse than
  // simply not promoting, since the finished database is the expensive thing here.
  for (const suffix of ["-wal", "-shm", ""]) {
    try {
      rmSync(`${path}${suffix}`, { force: true });
    } catch (error) {
      throw new PromoteBlocked(
        `built ${from} but could not replace ${path}${suffix} — something still has the ` +
          `database open (a Wallaby worker running the DB-backed specs, or an Extension ` +
          `Development Host). The finished build is KEPT at ${from}: close the holder and ` +
          `rename it over ${path}, or re-run the build.`,
        { cause: error }
      );
    }
  }
  // Only now that the destination is gone: the staging sidecars are stale by construction (the
  // build checkpoints its WAL before closing) and must not travel with the renamed file.
  for (const suffix of ["-wal", "-shm"]) {
    rmSync(`${from}${suffix}`, { force: true });
  }
  renameSync(from, path);
};
const NAMES_SCHEMA = join(root, "src", "data", "names-schema.sql");
/**
 * Which jmdict-simplified release to build from.
 *
 * Defaults to `latest`, deliberately: dictionary refreshes are decoupled from extension releases (the
 * rolling `dictionary-latest` GitHub Release), so a maintainer-triggered data build is SUPPOSED to
 * pick up current JMdict without a code change. Pinning by default would defeat that.
 *
 * The cost is that "the same command" produces different databases on different days, which matters
 * when reproducing a specific build. `JISHO_JMDICT_RELEASE=<tag>` pins it for exactly that — and the
 * resolved tag is recorded in `meta.dictRelease` either way, so any built database says which release
 * it came from. See the reproducibility note in CONVENTIONS.md for what can and cannot be pinned.
 */
const JMDICT_RELEASE = process.env.JISHO_JMDICT_RELEASE;
const RELEASE_API =
  JMDICT_RELEASE === undefined || JMDICT_RELEASE === ""
    ? "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
    : `https://api.github.com/repos/scriptin/jmdict-simplified/releases/tags/${JMDICT_RELEASE}`;

// `--names` builds the separate JMnedict names database (`jisho-names.db`), an optional download
// delivered as its own `jisho-names.db.zst` trio on the dictionary-latest release. It's ~743k
// entries and would roughly double the main DB, so it's never bundled into it. Runs independently
// of the word/kanji build.
const NAMES = process.argv.includes("--names");
// Build the database but skip the compressed release asset — for callers that only need something
// to query (see full-test.yml).
const NO_ARCHIVE = process.argv.includes("--no-archive");
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
/**
 * `fetch` with bounded retry, used for every source download.
 *
 * The build pulls from five independent hosts (api.github.com, ftp.edrdg.org,
 * downloads.tatoeba.org, lars.yencken.org, raw.githubusercontent.com) and previously had no retry at
 * all, so one transient blip on any of them killed a multi-minute run. That now also fails a release:
 * full-test.yml builds both databases before a publish is allowed.
 *
 * Retries transport errors and the statuses worth retrying (5xx, 429). A 4xx is our bug — a bad URL
 * or an unpinned asset name — so it returns immediately rather than waiting to fail three times.
 */
const FETCH_ATTEMPTS = 3;

const fetchRetrying = async (
  url: string,
  init?: RequestInit
): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    const retriable = (status: number): boolean =>
      status >= 500 || status === 429;
    try {
      const res = await fetch(url, init);
      if (res.ok || attempt === FETCH_ATTEMPTS || !retriable(res.status)) {
        return res;
      }
      console.log(
        `  retrying ${url} (${res.status}, attempt ${attempt}/${FETCH_ATTEMPTS})`
      );
    } catch (error) {
      if (attempt === FETCH_ATTEMPTS) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      console.log(
        `  retrying ${url} (${reason}, attempt ${attempt}/${FETCH_ATTEMPTS})`
      );
    }
    // Exponential backoff: 0.5s, then 1s.
    await new Promise((resolve) =>
      setTimeout(resolve, 500 * 2 ** (attempt - 1))
    );
  }
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetchRetrying(url, {
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

// Kanji-level JLPT on the MODERN N5-N1 scale (#55). Kanjidic ships a `jlptLevel`, but it is the
// pre-2010 four-level scale and does not convert: measured, 水 4→N5 and 私 3→N4 shift by one while
// 顔 3→N3 does not, so it is different data rather than a different encoding — hence a separate
// column rather than an overwrite.
//
// Source: onlyskin/kanjiapi's `jlpt.tsv` (MIT). Its commit message records the provenance as
// tanos.co.uk — Jonathan Waller, the SAME author as the word-level lists we already ship in
// `words.jlpt`, under the same CC-BY terms. So this adds no new licensing surface, and it explains
// why the file agrees with JLPT Sensei's published lists to within one kanji (分, absent here).
//
// Format: five tab-separated lines, `level ⇥ <run of kanji>`. Measured on the pinned commit:
// N5=79, N4=166, N3=367, N2=367, N1=1232 (2,211 total), no kanji at more than one level, and every
// one present in Kanjidic. Pinned for reproducibility; unchanged upstream since 2025-03.
const KANJI_JLPT_SHA = "f5cf050a82e407d93c5676427938d5ad2fbaf479";
const KANJI_JLPT_URL = `https://raw.githubusercontent.com/onlyskin/kanjiapi/${KANJI_JLPT_SHA}/jlpt.tsv`;
/** Per-level counts asserted at build time, so a silently-changed upstream file fails the build. */
const KANJI_JLPT_EXPECTED: Record<number, number> = {
  5: 79,
  4: 166,
  3: 367,
  2: 367,
  1: 1232
};

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

// `WORD_LEVEL_SENSE` (the -1 sentinel) is imported from ../src/shared/schema — the build writes it,
// the host reads it, so the constant lives with the other schema-shape values.
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
  const res = await fetchRetrying(asset.browser_download_url, {
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
  const res = await fetchRetrying(CJK_DECOMP_URL, {
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

/**
 * Fetch the modern N5-N1 kanji lists, as `literal → level` (5 = N5 … 1 = N1).
 *
 * Asserted against `KANJI_JLPT_EXPECTED` rather than trusted: this is a rolling `raw.githubusercontent`
 * path pinned to a commit, and the failure mode if it ever changed shape is a browse list that is
 * silently short — a user cannot tell "N3 has 367 kanji" from "N3 has 40 and the parse broke".
 */
const fetchKanjiJlpt = async (): Promise<Map<string, number>> => {
  console.log("Downloading kanji JLPT levels…");
  const res = await fetchRetrying(KANJI_JLPT_URL, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok) throw new Error(`kanji jlpt → ${res.status} ${res.statusText}`);
  const levels = new Map<string, number>();
  const seen: Record<number, number> = {};
  for (const line of (await res.text()).split(/\r?\n/)) {
    const [rawLevel, chars] = line.split("\t");
    const level = Number(rawLevel);
    if (!Number.isInteger(level) || level < 1 || level > 5 || !chars) continue;
    // Code points are exactly the unit wanted here: the line is a run of CJK ideographs with no
    // separators, and several jōyō kanji (𠮟, the standard form of 叱) are outside the BMP, so a
    // UTF-16 split would halve them. The rule's emoji/grapheme concern does not apply to this data.
    // oxlint-disable-next-line typescript/no-misused-spread
    const list = [...chars];
    seen[level] = list.length;
    for (const literal of list) {
      // A kanji at two levels would make the browse lists overlap and the badge ambiguous. The
      // pinned file has none; fail loudly rather than silently keeping whichever came last.
      const existing = levels.get(literal);
      if (existing !== undefined) {
        throw new Error(
          `kanji jlpt: ${literal} appears at both N${String(existing)} and N${String(level)}`
        );
      }
      levels.set(literal, level);
    }
  }
  for (const [level, expected] of Object.entries(KANJI_JLPT_EXPECTED)) {
    const actual = seen[Number(level)] ?? 0;
    if (actual !== expected) {
      throw new Error(
        `kanji jlpt: N${level} has ${String(actual)} kanji, expected ${String(expected)} — upstream data changed shape`
      );
    }
  }
  console.log(`  ${levels.size} kanji with an N-level`);
  return levels;
};

// ── Tatoeba example-sentence pool (F1) ─────────────────────────────────────────

/** Download a `.bz2` URL and return its decompressed bytes, plus the `Last-Modified` header. */
const fetchBz2 = async (
  url: string
): Promise<{ data: Buffer; lastModified: string }> => {
  const res = await fetchRetrying(url, {
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

/**
 * Precompute how many words each browse classifier holds (#27/#54).
 *
 * The browse tree shows ~90 counts at once and the tag autocomplete needs every one of them to hide
 * combinations that would narrow to zero — so this is asked constantly, and it cannot change until
 * the next dictionary build. Deriving it at runtime meant scanning all 406,028 `sense_tags` rows,
 * measured at ~2s on the full dictionary.
 *
 * ONE grouped pass over `sense_tags` rather than a count per classifier: 90 separate COUNT queries
 * would each re-walk the index. JLPT and frequency live on `words`, so they are counted separately.
 *
 * Writes what the CODE currently defines. An id the code later drops is simply ignored at read
 * time, and an id it gains before the next rebuild falls back to a live count — which is what keeps
 * adding a category a code-only change rather than one that needs new data.
 */
const writeClassifierCounts = (db: DatabaseSync): number => {
  const insert = db.prepare(
    "INSERT INTO classifier_counts(classifier_id, n) VALUES (?, ?)"
  );

  // Turso returns `any`; these two confine that boundary to one place rather than asserting at
  // each of the six call sites below.
  const countOf = (sql: string, ...params: Array<string | number>): number => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const row = db.prepare(sql).get(...params) as { n: number } | undefined;
    return row?.n ?? 0;
  };

  // Tag-backed classifiers, attributed in a single scan. Prefix families (v5*, v1*, vs*) match by
  // range, so they are checked separately from the exact codes.
  const exact = new Map<string, string[]>();
  const prefixes: Array<{ id: string; tagKind: string; code: string }> = [];
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (c.kind !== "tag") continue;
    if (c.prefix) prefixes.push({ id: c.id, tagKind: c.tagKind, code: c.code });
    else {
      const key = `${c.tagKind}\t${c.code}`;
      exact.set(key, [...(exact.get(key) ?? []), c.id]);
    }
  }

  const seen = new Map<string, Set<string>>();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const rows = db
    .prepare(
      `SELECT t.kind AS kind, t.code AS code, s.word_id AS word_id
         FROM sense_tags t JOIN senses s ON s.id = t.sense_id`
    )
    .all() as Array<{ kind: string; code: string; word_id: string }>;
  for (const r of rows) {
    // DISTINCT words, not rows: a word with three `v5*` senses is one godan verb, not three.
    const hits = [
      ...(exact.get(`${r.kind}\t${r.code}`) ?? []),
      ...prefixes
        .filter((p) => p.tagKind === r.kind && r.code.startsWith(p.code))
        .map((p) => p.id)
    ];
    for (const id of hits) {
      const set = seen.get(id) ?? new Set<string>();
      set.add(r.word_id);
      seen.set(id, set);
    }
  }

  let written = 0;
  for (const c of CLASSIFIER_BY_ID.values()) {
    let n: number;
    if (c.kind === "tag") {
      n = seen.get(c.id)?.size ?? 0;
    } else if (c.kind === "jlpt") {
      n = countOf("SELECT COUNT(*) AS n FROM words WHERE jlpt = ?", c.level);
    } else if (c.kind === "freq") {
      n = countOf(
        "SELECT COUNT(*) AS n FROM words WHERE freq_rank BETWEEN ? AND ?",
        c.from,
        c.to
      );
    } else if (c.result === "kanji") {
      n = countOf("SELECT COUNT(*) AS n FROM kanji_characters");
    } else if (c.result === "word") {
      n = countOf("SELECT COUNT(*) AS n FROM words");
    } else {
      // Names and places are counted from the SEPARATE names dictionary, which this build is not
      // writing — the host supplies those at request time.
      continue;
    }
    insert.run(c.id, n);
    written++;
  }
  return written;
};

const HAS_KANJI = /[㐀-鿿豈-﫿]/u;

/**
 * Resolve a segment's dictionary form to a JMdict entry id (words.id), or undefined if unknown.
 *
 * `pos` is the tokenizer's category, used to disambiguate between the several entries a surface can
 * belong to. Optional because the Tatoeba pool's B-line join has no tokenizer output to offer — it
 * resolves by headword alone, exactly as before.
 */
type WordResolver = (
  lemma: string,
  reading: string,
  pos?: PartOfSpeech,
  surface?: string
) => string | undefined;

/**
 * Parts of speech worth LINKING to a dictionary entry.
 *
 * This is the link policy only. It used to double as the colour policy — a word outside this set
 * was emitted as bare text, so it carried no part of speech and could not be coloured — which is
 * why examples expressed 4 of the 9 palette categories where the editor expressed all nine (#38).
 * Everything else gets `posToken` instead: typed, coloured, not tappable.
 *
 * PRONOUNS and ADNOMINALS are here because they are real dictionary words a reader may well want to
 * look up (彼, 私, あなた; この, 大きな) — and because both are small CLOSED classes, 79 and 47
 * distinct surfaces across the corpus, so their resolution is verifiable rather than open-ended.
 * They are only safe to link alongside `POS_CONFIRM`, which requires a candidate entry to actually
 * carry `pn`/`adj-pn`; without it, 彼 links to "that" and 君 to the suffix "Mr".
 *
 * PARTICLES and AUXILIARIES stay out deliberately. Opening a JMdict entry for は teaches nothing,
 * and particles are 29% of all tokens — making them tappable would bury the useful links.
 */
const LINKABLE_POS = new Set<PartOfSpeech>([
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "adnominal"
]);

/**
 * Annotate a Japanese sentence at build time: wrap kanji-bearing segments in mirrordown ruby
 * ({漢字|かんじ}) AND wrap each resolvable content word in a markdown link to its dictionary entry
 * (`[word](pos:entseq)`, see shared/exampleLinks). The link SPAN is the whole word (okurigana +
 * conjugation), so the webview gets a correct word boundary + tap target — the furigana-group
 * approach gave unclear boundaries. `resolve` maps a segment's lemma+reading to a words.id; segments
 * that don't resolve (or aren't content words) stay plain text with any furigana. The DB stores the
 * result, so the webview renders it with no runtime tokenizer cost.
 */
const annotateExample = async (
  ja: string,
  resolve: WordResolver
): Promise<string> => {
  const segments = await segment(ja);
  let out = "";
  for (const seg of segments) {
    // Furigana on the whole segment surface (conjugations annotate as one word, as before).
    const text =
      HAS_KANJI.test(seg.surface) && seg.reading !== ""
        ? toRubyMarkdown(seg.surface, toHiragana(seg.reading))
        : seg.surface;

    const id = LINKABLE_POS.has(seg.pos)
      ? resolve(seg.lemma, toHiragana(seg.reading), seg.pos, seg.surface)
      : undefined;
    if (id !== undefined) {
      out += linkToken(text, seg.pos, id);
    } else if (seg.pos === "other") {
      // Punctuation, whitespace, Latin — no grammatical claim to make, so no annotation. Wrapping
      // these would grow the stored markup for nothing and imply a category they do not have.
      out += text;
    } else {
      // Typed but unlinked: a particle, an auxiliary, or a content word that did not resolve. The
      // tokenizer already classified it — this stops the build from throwing that away.
      out += posToken(text, seg.pos);
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
  const res = await fetchRetrying(JMDICT_XML_URL, {
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
    const res = await fetchRetrying(`${JLPT_RAW_BASE}/${file}`, {
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
  const res = await fetchRetrying(KANJIUM_ACCENTS_URL, {
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
  /** kanji → modern N5-N1 level, 5..1 (#55). Absent for the ~8k kanji no level lists. */
  kanjiJlpt: Map<string, number>;
  /** Tatoeba example pool + the exports' last-modified dates (F1). */
  tatoeba: Awaited<ReturnType<typeof fetchTatoeba>>;
  /** Yencken similar-kanji tables (stroke-edit + Yeh-Li radical) + their dates (F3). */
  yencken: {
    stroke: Awaited<ReturnType<typeof fetchYencken>>;
    radical: Awaited<ReturnType<typeof fetchYencken>>;
  };
  /** The resolved jmdict-simplified release tag, recorded so a build says what it came from. */
  release: string;
}

const downloadSources = async (): Promise<Sources> => {
  console.log(
    JMDICT_RELEASE === undefined || JMDICT_RELEASE === ""
      ? "Resolving latest jmdict-simplified release…"
      : `Resolving pinned jmdict-simplified release ${JMDICT_RELEASE}…`
  );
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
    yenckenRadical,
    kanjiJlpt
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
    fetchYencken(YENCKEN_RADICAL_URL),
    fetchKanjiJlpt()
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
    kanjiJlpt,
    tatoeba,
    yencken: { stroke: yenckenStroke, radical: yenckenRadical },
    release: release.tag_name
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
    kanjiJlpt,
    tatoeba,
    yencken
  } = sources;
  mkdirSync(dirname(OUT_DB), { recursive: true });
  // Clear only the STAGING path here. The destination is left alone until the promote at the end,
  // so a reader holding the old DB open cannot fail the build before it starts (see `staged`).
  const buildDb = staged(OUT_DB);
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${buildDb}${suffix}`, { force: true });
  }

  const db = new DatabaseSync(buildDb);
  db.exec(readFileSync(SCHEMA, "utf8"));

  // Bulk-import fast path: one transaction + relaxed durability. This is a build artifact we
  // can regenerate at will, so trading crash-safety for ~30× throughput is the right call.
  // (Without a wrapping transaction, every INSERT commits+fsyncs individually.)
  db.exec("PRAGMA synchronous=OFF");
  db.exec("BEGIN");

  // Tag dictionary.
  const insTag = db.prepare("INSERT INTO tags(tag, description) VALUES (?, ?)");
  for (const [tag, description] of Object.entries(dict.tags)) {
    insTag.run(tag, description);
  }

  const insWord = db.prepare(
    "INSERT INTO words(id, is_common, freq_rank, is_uk, sort_key) VALUES (?, ?, ?, ?, ?)"
  );
  const insKanji = db.prepare(
    "INSERT INTO kanji(word_id, position, text, is_common, tags_json) VALUES (?, ?, ?, ?, ?)"
  );
  const insKana = db.prepare(
    "INSERT INTO kana(word_id, position, text, is_common, tags_json, applies_to_kanji_json, sort_key) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insSense = db.prepare(
    `INSERT INTO senses(word_id, position, info_json,
       applies_to_kanji_json, applies_to_kana_json, related_json, antonym_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insGloss = db.prepare(
    "INSERT INTO glosses(sense_id, position, text) VALUES (?, ?, ?)"
  );
  const insSenseTag = db.prepare(
    "INSERT INTO sense_tags(sense_id, kind, code) VALUES (?, ?, ?)"
  );
  const insWordTag = db.prepare(
    "INSERT INTO word_tags(word_id, code) VALUES (?, ?)"
  );
  const insSentence = db.prepare(
    `INSERT INTO sentences(word_id, sense_position, position, ja_furigana, en, tatoeba_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insTerm = db.prepare(
    "INSERT INTO search_terms(word_id, kind, term, term_lower, is_common, is_primary, sense_breadth, term_norm) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insKanjiChar = db.prepare(
    `INSERT INTO kanji_characters(literal, grade, stroke_count, frequency, jlpt, jlpt_n,
       on_json, kun_json, meanings_json, nanori_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insComponent = db.prepare(
    "INSERT INTO kanji_components(literal, component) VALUES (?, ?)"
  );
  const insTreeEdge = db.prepare(
    "INSERT INTO component_tree(literal, child, position) VALUES (?, ?, ?)"
  );
  const insSimilar = db.prepare(
    "INSERT INTO similar_kanji(literal, similar, position) VALUES (?, ?, ?)"
  );
  const insRadical = db.prepare(
    "INSERT INTO radicals(radical, stroke_count, kanji_json, position) VALUES (?, ?, ?, ?)"
  );
  const insKanjiTerm = db.prepare(
    "INSERT INTO search_terms(kanji, kind, term, term_lower, is_common, is_primary) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insPitch = db.prepare(
    "INSERT INTO pitch_accents(word_id, reading, accents_json) VALUES (?, ?, ?)"
  );

  // Commit in batches and checkpoint between them: a single giant transaction can never fold its
  // pages back into the main file, so the WAL balloons unboundedly (the full build's WAL passed
  // 5GB before this fix). Checkpointing per batch keeps the WAL at roughly one batch's size.
  // The word index / resolver linkifies inline example words to their entries (F1-links); built once
  // here and reused by the Tatoeba pool pass.
  const resolve = makeResolver(buildWordIndex(dict));
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
      insSenseTag,
      insWordTag,
      insTerm,
      insSentence,
      priority,
      resolve
    });
    done++;
    checkpointEvery(db, done);
    if (done % BATCH === 0) console.log(`  …${done}/${total} entries`);
  }

  db.exec("COMMIT");

  // ── Pitch accent pass (Kanjium) ───────────────────────────────────────────
  // Join per word: for each reading, look for a pitch pattern keyed by (a writing, reading) — or
  // (reading, reading) for kana-only words / when no kanji writing matches. The map's key was
  // built the same way (`surface\treading`, surface being a writing or the reading itself). One
  // row per (word, reading) that hit; readings with no accent data are simply omitted.
  db.exec("BEGIN");
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
        insPitch.run(word.id, reading, JSON.stringify(positions));
        pitchRows++;
      }
    }
    checkpointEvery(db, ++pdone);
  }
  db.exec("COMMIT");
  console.log(`  pitch: ${pitchRows} (word, reading) accent rows`);

  // ── Kanji pass ────────────────────────────────────────────────────────────
  // Import characters first (search_terms.kanji FK-references kanji_characters), then their
  // Kradfile components, then Radkfile radicals. Same batched-checkpoint discipline.
  db.exec("BEGIN");
  const kanjiSet = new Set<string>();
  let kdone = 0;
  for (const char of kanjidic.characters) {
    importKanji(char, { insKanjiChar, insKanjiTerm, jlptN: kanjiJlpt });
    kanjiSet.add(char.literal);
    checkpointEvery(db, ++kdone);
  }
  // Kradfile components — only for kanji we have a character row for (FK).
  for (const [literal, components] of Object.entries(kradfile.kanji)) {
    if (!kanjiSet.has(literal)) continue;
    for (const component of components) {
      insComponent.run(literal, component);
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
      insTreeEdge.run(literal, child, position);
      position++;
    }
  }
  // Radkfile radicals, with their positional category (spec 04) voted from AnimCJK geometry. Same
  // pinned SHA as the stroke SVGs (one constant, two consumers) so a radical is never classified
  // against different data than the drawing it appears in.
  console.log("Downloading dictionaryJa.txt (radical positions)…");
  const acjkMap = await fetchAcjkMap();
  const positions = voteRadicalPositions(radkfile.radicals, acjkMap);
  for (const [radical, info] of Object.entries(radkfile.radicals)) {
    insRadical.run(
      radical,
      info.strokeCount,
      JSON.stringify(info.kanji),
      positions.get(radical) ?? null
    );
  }
  const positioned = positions.size;
  console.log(
    `  radicals: ${positioned}/${Object.keys(radkfile.radicals).length} with a position category`
  );

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
      insSimilar.run(literal, s, position);
      position++;
      similarRows++;
    }
  }
  db.exec("COMMIT");
  console.log(`  kanji: ${kanjiSet.size} characters`);
  console.log(
    `  similar: ${similarRows} rows (${yenckenCovered} kanji from Yencken, rest from the component heuristic)`
  );

  // ── JLPT pass ─────────────────────────────────────────────────────────────
  // Join word-level JLPT by JMdict id (exact PK). Only ids present in this variant's JMdict get
  // updated, so the common-only build naturally covers fewer list rows than the full build. Record
  // the match rate so a poor join (a sign the source drifted from JMdict) is visible in `meta`.
  db.exec("BEGIN");
  const updJlpt = db.prepare("UPDATE words SET jlpt = ? WHERE id = ?");
  let jlptMatched = 0;
  let jdone = 0;
  for (const [id, level] of jlpt) {
    const { changes } = updJlpt.run(level, id);
    if (changes > 0) jlptMatched++;
    checkpointEvery(db, ++jdone);
  }
  db.exec("COMMIT");
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

  const classifierRows = writeClassifierCounts(db);
  console.log(`  classifiers: ${classifierRows} precomputed counts`);

  // Attribution / provenance.
  const insMeta = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
  // The schema version the host verifies on open (see src/shared/schema.ts). Stamped first so it is
  // present even if a later meta insert fails.
  // Provenance and attribution as DATA, not 32 imperative writes. CONVENTIONS.md requires every new
  // dataset to extend attribution in the same change; a list makes that obligation something you can
  // see a hole in, and keeps each source's rows (what it is, its licence, its version, its yield)
  // adjacent instead of scattered down the function.
  const metaRows: Array<[string, string]> = [
    [SCHEMA_VERSION_KEY, String(SCHEMA_VERSION)],
    ["variant", VARIANT],

    ["source", `JMdict (jmdict-simplified, eng-${VARIANT})`],
    ["license", "EDRDG License (https://www.edrdg.org/edrdg/licence.html)"],
    ["dictRelease", sources.release],
    ["dictDate", dict.dictDate],
    ["dictRevisions", dict.dictRevisions.join(", ")],
    ["wordCount", String(total)],

    ["kanjidicDate", kanjidic.dictDate],
    ["kanjidicVersion", kanjidic.databaseVersion],
    ["kanjiCount", String(kanjiSet.size)],

    [
      "similarKanjiSource",
      "Similar kanji: Lars Yencken's kanji-confusion data (stroke-edit + Yeh-Li radical distance) for jōyō, with a Kradfile-component heuristic filling in the rest"
    ],
    [
      "similarKanjiLicense",
      "CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) — Lars Yencken, https://lars.yencken.org/datasets/kanji-confusion/"
    ],
    ["similarKanjiStrokeDate", yencken.stroke.lastModified],
    ["similarKanjiRadicalDate", yencken.radical.lastModified],
    ["similarKanjiRows", String(similarRows)],

    [
      "radicalPositionSource",
      "Radical positions: derived from AnimCJK (© FM&SH) component geometry, Arphic Public License"
    ],
    [
      "strokeSource",
      "Stroke order: AnimCJK (© FM&SH), glyph paths under the Arphic Public License"
    ],

    [
      // One entry for both scales: the word lists and the kanji lists are the SAME author's data,
      // reaching us through different intermediaries. Crediting them separately would imply two
      // provenances to reconcile when there is only one.
      "jlptSource",
      "JLPT levels (unofficial): Jonathan Waller / tanos.co.uk — words via stephenmk/yomitan-jlpt-vocab, kanji via onlyskin/kanjiapi"
    ],
    [
      "jlptLicense",
      "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)"
    ],
    ["jlptMatched", String(jlptMatched)],
    ["jlptKanjiMatched", String(kanjiJlpt.size)],

    ["pitchSource", "Pitch accent: Kanjium (Uros O.), from NHK/Wadoku data"],
    [
      "pitchLicense",
      "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)"
    ],
    ["pitchRows", String(pitchRows)],

    [
      "sentenceSource",
      "Example sentences: Tanaka corpus (inline, via jmdict-examples-eng) + the fuller Tatoeba corpus (more-examples pool)"
    ],
    [
      "sentenceLicense",
      "CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/deed.en)"
    ],
    ["sentenceRows", String(sentenceRows)],
    ["tatoebaPoolRows", String(tatoebaRows)],
    // The exports roll weekly; their last-modified dates are the closest thing to a version.
    ["tatoebaIndicesDate", tatoeba.dates.indices],
    ["tatoebaJpnDate", tatoeba.dates.jpn],
    ["tatoebaEngDate", tatoeba.dates.eng]
  ];
  for (const [key, value] of metaRows) insMeta.run(key, value);

  console.log(
    `  sentences: ${sentenceRows} inline + ${tatoebaRows} pool example rows`
  );
  // Gate on what was built, before anything is written that a release could pick up. Reads as a
  // manifest of what a good build looks like; see FLOORS for why these numbers and not others.
  atLeast("entries", total, FLOORS.entries);
  atLeast("kanji characters", kanjiSet.size, FLOORS.kanjiCharacters);
  atLeast("pitch rows", pitchRows, FLOORS.pitchRows);
  atLeast("similar-kanji rows", similarRows, FLOORS.similarRows);
  atLeast("radical positions", positioned, FLOORS.radicalPositions);
  atLeast("inline sentences", sentenceRows, FLOORS.inlineSentences);
  atLeast("pool sentences", tatoebaRows, FLOORS.poolSentences);
  // Not tracked in a local (it is written per sense inside importWord), so read it back.
  const tagRow: unknown = db
    .prepare("SELECT COUNT(*) AS n FROM sense_tags")
    .get();
  const senseTagCount =
    typeof tagRow === "object" && tagRow !== null && "n" in tagRow
      ? Number(tagRow.n)
      : 0;
  atLeast("sense tags", senseTagCount, FLOORS.senseTags);
  if (jlpt.size > 0 && jlptMatched / jlpt.size < RATE_FLOORS.jlptMatch) {
    throw new Error(
      `build matched ${jlptMatched}/${jlpt.size} JLPT words ` +
        `(${((jlptMatched / jlpt.size) * 100).toFixed(1)}%), below the ` +
        `${(RATE_FLOORS.jlptMatch * 100).toFixed(0)}% floor — the id join likely broke.`
    );
  }

  // builtAt last, so it reflects the moment the build actually completed its gate.
  const builtAt = new Date().toISOString();
  insMeta.run("builtAt", builtAt);

  // Fold the WAL back into the main file so `jisho.db` is a self-contained, shippable artifact
  // (we deliver only the single .db; a leftover -wal would be required at read time otherwise).
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  promote(OUT_DB);

  // Emit a tiny version sidecar so `ensureDatabase` can detect a newer build (or a variant
  // switch) and refresh the copy it caches in globalStorage — without having to open (and lock)
  // the database to read its meta.
  // The SCHEMA is part of the identity, not just the date. Two things depend on it:
  //
  //  - `check-data-release.ts` reads this sidecar off the published release to refuse an extension
  //    release whose schema the artifact does not match. That check did not exist when the data
  //    workflow silently broke on 2026-08-03, which left the published dictionary at schema 5 while
  //    the extension moved to 6 — every first install would have failed on a schema mismatch.
  //  - `ensureDatabase` compares this string opaquely, so a schema change now forces a refresh of a
  //    cached copy that would otherwise be kept for having the same date.
  const version = `${VARIANT} schema${SCHEMA_VERSION} ${dict.dictDate} ${builtAt}`;
  writeFileSync(`${OUT_DB}.version`, version, "utf8");
  console.log(`\nWrote ${OUT_DB} — ${total} entries (${VARIANT}).`);

  // Both variants are published to the dictionary-latest release: the zstd-compressed asset, its
  // sha256, and the version string the downloader compares against its sidecar.
  //
  // FULL is what users download on first run. COMMON is published for contributors and CI — it is
  // the variant the test suites run against, and downloading it beats spending five minutes of a
  // dev setup (or a CI job) rebuilding a database whose inputs have not changed.
  console.log("Compressing release asset…");
  const zstPath = await writeReleaseAsset(
    OUT_DB,
    join(dirname(OUT_DB), FULL ? "jisho-full.db" : "jisho-common.db"),
    version
  );
  console.log(`Wrote ${zstPath} (+ .sha256, .version)`);
};

// A prepared statement, as returned by the (async) `prepare` once awaited.
type Statement = ReturnType<DatabaseSync["prepare"]>;

interface Stmts {
  insWord: Statement;
  insKanji: Statement;
  insKana: Statement;
  insSense: Statement;
  insGloss: Statement;
  insSenseTag: Statement;
  insWordTag: Statement;
  insTerm: Statement;
  insSentence: Statement;
  /** JMdict-id → priority tags, from the original XML (jmdict-simplified drops them). */
  priority: Map<string, WordPriority>;
  /** Resolve an example word to its entry id, for the linkified annotation. */
  resolve: WordResolver;
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
/**
 * Floors for the figures the build already computes, so a collapsed join FAILS instead of shipping.
 *
 * Every number below was previously printed to the console and read by nobody: the build's only
 * `throw`s were about INPUTS (a failed fetch, a malformed archive), so if a join silently stopped
 * matching, the build succeeded, verify-db passed — it checks liveness, the schema version and one
 * known word id, not coverage — and the release gate published it.
 *
 * These are EMPIRICAL, taken from the 2026-07-29 common build with a wide margin, not specified
 * minimums. They are deliberately far below current values: the job is catching a collapse (a join
 * matching 3% instead of 93%), not policing normal upstream drift. Calibrating on the COMMON subset
 * makes them valid for `--full` too, which only ever has more of everything.
 *
 * When a figure legitimately falls — an upstream source shrinks — move the floor and say why.
 */
const FLOORS = {
  /** 22,624 common / ~218k full. */
  entries: 18000,
  /** 10,384 — Kanjidic, variant-independent. */
  kanjiCharacters: 9000,
  /** 22,429 (word, reading) rows. */
  pitchRows: 18000,
  /** 24,207 rows, 1,945 of them Yencken-derived. */
  similarRows: 20000,
  /** 251 of 253 radicals classified (spec 04). */
  radicalPositions: 220,
  /** 65,903 tag rows over 173 codes (spec 15). */
  senseTags: 55000,
  /** 17,301 inline Tanaka + 116,269 Tatoeba pool. */
  inlineSentences: 14000,
  poolSentences: 90000,
  /** 743,538 names — the separate JMnedict build. */
  names: 600000
};

/** Rate floors, where a ratio is the meaningful signal rather than a count. */
const RATE_FLOORS = {
  /** 93.0% of the JLPT word list matched a JMdict id. */
  jlptMatch: 0.8
};

const atLeast = (label: string, actual: number, floor: number): void => {
  if (actual >= floor) return;
  throw new Error(
    `build produced ${label} = ${actual}, below the floor of ${floor}. ` +
      `Either an upstream source changed shape or a join broke — investigate before shipping. ` +
      `If the drop is legitimate, lower the floor in FLOORS and record why.`
  );
};

const BATCH = 5000;

/**
 * One batched-commit checkpoint. Call it after each item; it commits, truncates the WAL and reopens
 * a transaction every `BATCH` items.
 *
 * This exists because the three lines it replaces were hand-copied at six loop sites, and they are
 * not optional: one giant transaction ballooned the WAL past 5GB (CONVENTIONS.md). A new import loop
 * that forgets them does not fail a test — it fails as a multi-gigabyte file — so the discipline
 * belongs in one place that every loop calls rather than in a pattern each loop remembers.
 *
 * Callers still own the surrounding BEGIN and the final COMMIT + checkpoint before close(), because
 * those bracket a whole pass rather than pacing one.
 */
const checkpointEvery = (db: DatabaseSync, done: number): void => {
  if (done % BATCH !== 0) return;
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("BEGIN");
};

/** Imports one word; returns the number of example sentences inserted for it. */
const importWord = async (word: JMdictWord, s: Stmts): Promise<number> => {
  const wordCommon =
    word.kanji.some((k) => k.common) || word.kana.some((k) => k.common) ? 1 : 0;
  // JMdict's own priority data, joined by entry id. Absent for most entries (nfXX only covers the
  // top ~24k words), which is why freq_rank is nullable and ranking must not assume it.
  const pri = s.priority.get(word.id);
  // `uk` ("usually written using kana alone") is asked of the WORD by every query that wants it, so
  // it is resolved once here instead of re-scanning misc_json per sense at query time.
  const isUk = word.sense.some((sense) => sense.misc.includes("uk")) ? 1 : 0;
  // The word's own gojūon key, denormalized from its FIRST kana reading (the same value that row
  // stores). Computed here rather than reached through a correlated subquery at query time, which
  // is what made browsing a broad category cost ~2s on the full dictionary — see `words.sort_key`
  // in schema.sql. Empty when a word has no kana at all, so it sorts last.
  const wordSortKey = word.kana.length > 0 ? sortKey(word.kana[0].text) : "";
  s.insWord.run(word.id, wordCommon, pri?.freqRank ?? null, isUk, wordSortKey);
  for (const code of new Set(pri?.tags ?? [])) {
    s.insWordTag.run(word.id, code);
  }
  let sentenceCount = 0;

  for (let i = 0; i < word.kanji.length; i++) {
    const k = word.kanji[i];
    s.insKanji.run(
      word.id,
      i,
      k.text,
      k.common ? 1 : 0,
      JSON.stringify(k.tags)
    );
    s.insTerm.run(
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
        s.insTerm.run(
          word.id,
          "char",
          char,
          char,
          k.common ? 1 : 0,
          0,
          1,
          null // not a kana row — no fold
        );
      }
    }
  }
  for (let i = 0; i < word.kana.length; i++) {
    const k = word.kana[i];
    s.insKana.run(
      word.id,
      i,
      k.text,
      k.common ? 1 : 0,
      JSON.stringify(k.tags),
      JSON.stringify(k.appliesToKanji),
      sortKey(k.text)
    );
    s.insTerm.run(
      word.id,
      "kana",
      k.text,
      k.text.toLowerCase(),
      k.common ? 1 : 0,
      i === 0 ? 1 : 0,
      1,
      // Only kana rows carry a fold: kanji "typos" are a visual-similarity problem and romaji is
      // edit-distance, so neither belongs in this index.
      searchFold(k.text)
    );
    // Hepburn romaji of the reading, so learners can search by transliteration ("taberu").
    // Romaji is latin, so it matches via the query layer's case-insensitive `term_lower` path.
    const romaji = toRomaji(k.text);
    if (romaji !== "" && romaji !== k.text) {
      s.insTerm.run(
        word.id,
        "romaji",
        romaji,
        romaji.toLowerCase(),
        k.common ? 1 : 0,
        i === 0 ? 1 : 0,
        1,
        null // not a kana row — no fold
      );
    }
  }
  for (let i = 0; i < word.sense.length; i++) {
    const sense = word.sense[i];
    const { lastInsertRowid: senseId } = s.insSense.run(
      word.id,
      i,
      JSON.stringify(sense.info),
      JSON.stringify(sense.appliesToKanji),
      JSON.stringify(sense.appliesToKana),
      JSON.stringify(sense.related),
      JSON.stringify(sense.antonym)
    );
    // Tag codes as rows (spec 15). De-duplicated per (kind, code) because the PK forbids repeats and
    // JMdict does occasionally list one twice on a sense.
    for (const [kind, codes] of [
      ["pos", sense.partOfSpeech],
      ["misc", sense.misc],
      ["field", sense.field],
      ["dialect", sense.dialect]
    ] as const) {
      for (const code of new Set(codes)) {
        s.insSenseTag.run(senseId, kind, code);
      }
    }
    // How many glosses this sense carries — a specificity signal for ranking. "to eat" alone
    // (食べる) is a much stronger match for "eat" than "to eat, to drink, to smoke, to take"
    // (喫する), where it's one of four near-synonyms. See schema.sql's sense_breadth.
    const breadth = sense.gloss.length;
    for (let g = 0; g < sense.gloss.length; g++) {
      const gloss = sense.gloss[g];
      const isPrimary = i === 0 && g === 0 ? 1 : 0;
      s.insGloss.run(senseId, g, gloss.text);
      s.insTerm.run(
        word.id,
        "gloss",
        gloss.text,
        gloss.text.toLowerCase(),
        wordCommon,
        isPrimary,
        breadth,
        null // not a kana row — no fold
      );
      // Many JMdict glosses carry parenthetical clarifications — "water (esp. cool or cold)" —
      // which block exact/whole-word matching on the bare word. Index a stripped variant too so
      // "water" matches 水 exactly.
      const stripped = gloss.text
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped !== "" && stripped !== gloss.text) {
        s.insTerm.run(
          word.id,
          "gloss",
          stripped,
          stripped.toLowerCase(),
          wordCommon,
          isPrimary,
          breadth,
          null // not a kana row — no fold
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
        s.insTerm.run(
          word.id,
          "word",
          w,
          w,
          wordCommon,
          isPrimary,
          breadth,
          null // not a kana row — no fold
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
      s.insSentence.run(
        word.id,
        i,
        kept,
        await annotateExample(ja, s.resolve),
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
  /**
   * Every JMdict POS code across all of this entry's senses, for POS-aware resolution.
   *
   * A surface routinely belongs to several entries, and taking the first blindly picks the wrong
   * one often enough to matter: 彼's first candidate glosses "that" (あれ) rather than "he", and
   * 君's second is the suffix "Mr" — not a pronoun at all. Matching the tokenizer's category
   * against these codes is what makes a link trustworthy.
   */
  pos: Set<string>;
  /**
   * Every written form of this entry (kanji writings + kana readings), for the `INVARIANT_POS`
   * exactness check — "is this segment really just this word, or did the tokenizer merge in
   * something that follows it?".
   */
  forms: Set<string>;
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
    const ref: WordRef = {
      id: word.id,
      senseCount: word.sense.length,
      pos: new Set(word.sense.flatMap((s) => s.partOfSpeech)),
      forms: new Set([
        ...word.kanji.map((k) => k.text),
        ...word.kana.map((k) => k.text)
      ])
    };
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

type WordIndex = ReturnType<typeof buildWordIndex>;

/**
 * JMdict POS codes that confirm an entry really is the category the tokenizer said.
 *
 * Only the categories that need confirming are listed. Nouns and verbs are left unconstrained
 * because their surfaces are overwhelmingly unambiguous and JMdict's noun tagging is broad enough
 * (`n`, `n-adv`, `n-t`, `vs`…) that a strict list would reject good matches — the closed-class
 * words below are the ones where a wrong first candidate is both likely and obvious to a reader.
 */
const POS_CONFIRM: Partial<Record<PartOfSpeech, readonly string[]>> = {
  pronoun: ["pn"],
  adnominal: ["adj-pn"],
  adjective: ["adj-i", "adj-na", "adj-no", "adj-t", "adj-f", "adj-ix"],
  adverb: ["adv", "adv-to"]
};

/**
 * Categories that NEVER inflect, so the linked surface must equal a dictionary form exactly.
 *
 * Verbs and adjectives conjugate — 食べました legitimately links to 食べる, and that longer span is
 * the whole point of the word-boundary work — so an exactness rule would be wrong for them. But a
 * pronoun or adnominal is invariant: if the segment is longer than every form the entry has, the
 * tokenizer merged in trailing material, and linking it points the reader at a word they did not
 * tap. Measured before this check: そのこと → その, この時 → この, あの方たち → あの — 8.9% of
 * adnominal links and 5.7% of pronoun links.
 */
const INVARIANT_POS = new Set<PartOfSpeech>(["pronoun", "adnominal"]);

/**
 * A resolver from a tokenized example word to its entry id, for the linkified annotation.
 *
 * Prefers an exact (dictionary-form, reading) match, then the dictionary form as a kanji writing,
 * then as a kana reading — the same most-specific-first order as the pool's B-line join.
 *
 * Among the candidates for a surface it prefers one whose JMdict POS tags AGREE with the category
 * the tokenizer assigned. A surface routinely belongs to several entries, and the old
 * take-the-first rule picked wrongly in exactly the cases a reader would notice: 彼 resolved to the
 * あれ "that" entry rather than "he", and 君 to the honorific suffix "Mr". For categories in
 * `POS_CONFIRM` the agreement is REQUIRED — if no candidate carries the tag, the word stays
 * unlinked (still coloured) rather than linking somewhere wrong, because for a closed class a
 * missing link is much cheaper than a misleading one.
 */
const makeResolver =
  (index: WordIndex): WordResolver =>
  (lemma, reading, pos, surface) => {
    const exact =
      reading !== ""
        ? index.byKanjiReading.get(`${lemma}\t${reading}`)
        : undefined;
    const refs =
      exact ?? index.byKanji.get(lemma) ?? index.byReading.get(lemma);
    if (refs === undefined || refs.length === 0) return undefined;

    const confirm = pos === undefined ? undefined : POS_CONFIRM[pos];
    if (confirm === undefined) return refs[0].id;

    const agreed = refs.filter((r) => confirm.some((code) => r.pos.has(code)));
    // No agreement means this surface's entries are all some OTHER part of speech, so linking any
    // of them would send the reader to a word they did not tap.
    if (agreed.length === 0) return undefined;

    // For a class that never inflects, the segment must BE the word — see `INVARIANT_POS`.
    if (pos !== undefined && INVARIANT_POS.has(pos) && surface !== undefined) {
      return agreed.find((r) => r.forms.has(surface))?.id;
    }
    return agreed[0].id;
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
  db: DatabaseSync,
  dict: JMdict,
  examples: TatoebaExample[],
  s: PoolStmts
): Promise<number> => {
  const index = buildWordIndex(dict);
  // Linkified-annotation resolver, from the same index the B-line join uses.
  const resolveWord = makeResolver(index);

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
  const inlineIds = db.prepare(
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
  const inlineIdsFor = (wordId: string): Set<number> => {
    const out = new Set<number>();
    const result: unknown = inlineIds.all(wordId);
    if (Array.isArray(result)) {
      for (const row of result as unknown[]) {
        const id = readTatoebaId(row);
        if (Number.isFinite(id)) out.add(id);
      }
    }
    return out;
  };

  db.exec("BEGIN");
  let rows = 0;
  let done = 0;
  for (const [wordId, list] of pending) {
    const already = inlineIdsFor(wordId);
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
      s.insSentence.run(
        wordId,
        p.sensePosition,
        base + nth,
        await annotateExample(p.ja, resolveWord),
        p.en,
        p.tatoebaId,
        "tatoeba"
      );
      rows++;
    }
    checkpointEvery(db, ++done);
  }
  db.exec("COMMIT");
  return rows;
};

interface KanjiStmts {
  insKanjiChar: Statement;
  insKanjiTerm: Statement;
  /** Modern N5-N1 levels, keyed by literal (#55). Absent for the ~8k kanji no level lists. */
  jlptN: Map<string, number>;
}

const importKanji = (char: Kanjidic2Character, s: KanjiStmts): void => {
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

  s.insKanjiChar.run(
    char.literal,
    char.misc.grade,
    char.misc.strokeCounts[0] ?? null,
    char.misc.frequency,
    char.misc.jlptLevel,
    s.jlptN.get(char.literal) ?? null,
    JSON.stringify(on),
    JSON.stringify(kun),
    JSON.stringify(meanings),
    JSON.stringify(nanori)
  );

  // The literal itself, matched exactly for a single-character CJK query.
  s.insKanjiTerm.run(
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
    s.insKanjiTerm.run(char.literal, "kanji_meaning", w, w, isCommon, 0);
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
  const res = await fetchRetrying(url, {
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
  // Staging path only (see `staged`); the live DB is replaced by `promote` once the build succeeds.
  // The .version sidecar is the exception — it describes the DB about to be replaced, and is
  // rewritten on success, so clearing it now keeps a failed build from leaving a version that
  // claims more than the file behind it delivers.
  const buildDb = staged(NAMES_DB);
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${buildDb}${suffix}`, { force: true });
  }
  rmSync(`${NAMES_DB}.version`, { force: true });

  const db = new DatabaseSync(buildDb);
  db.exec(readFileSync(NAMES_SCHEMA, "utf8"));
  db.exec("PRAGMA synchronous=OFF");
  db.exec("BEGIN");

  const insTag = db.prepare(
    "INSERT INTO name_tags(tag, description) VALUES (?, ?)"
  );
  for (const [tag, description] of Object.entries(dict.tags)) {
    insTag.run(tag, description);
  }

  const insWord = db.prepare("INSERT INTO name_words(id) VALUES (?)");
  const insKanji = db.prepare(
    "INSERT INTO name_kanji(word_id, position, text) VALUES (?, ?, ?)"
  );
  const insKana = db.prepare(
    "INSERT INTO name_kana(word_id, position, text, applies_to_kanji_json) VALUES (?, ?, ?, ?)"
  );
  const insTrans = db.prepare(
    "INSERT INTO name_translations(word_id, position, types_json, translations_json) VALUES (?, ?, ?, ?)"
  );
  const insTerm = db.prepare(
    "INSERT INTO name_search_terms(word_id, kind, term, term_lower, is_primary) VALUES (?, ?, ?, ?, ?)"
  );

  const total = dict.words.length;
  let done = 0;
  for (const name of dict.words) {
    importName(name, { insWord, insKanji, insKana, insTrans, insTerm });
    checkpointEvery(db, ++done);
    if (done % BATCH === 0) console.log(`  …${done}/${total} names`);
  }
  db.exec("COMMIT");

  const insMeta = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
  insMeta.run("source", "JMnedict (jmdict-simplified, jmnedict-all)");
  insMeta.run("dictDate", dict.dictDate);
  insMeta.run("dictRevisions", dict.dictRevisions.join(", "));
  insMeta.run(
    "license",
    "EDRDG License (https://www.edrdg.org/edrdg/licence.html)"
  );
  const builtAt = new Date().toISOString();
  atLeast("names", total, FLOORS.names);

  insMeta.run("variant", "names");
  insMeta.run("nameCount", String(total));
  insMeta.run("builtAt", builtAt);

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  promote(NAMES_DB);

  const version = `names ${dict.dictDate} ${builtAt}`;
  writeFileSync(`${NAMES_DB}.version`, version, "utf8");
  console.log(`\nWrote ${NAMES_DB} — ${total} names.`);

  // Names ship only as a download (no bundled dev copy), so the zstd trio is the deliverable — but
  // compressing 409MB at level 19 costs more than building the DB did, and a run that only needs a
  // database to test against (CI's release gate) has no use for it.
  if (NO_ARCHIVE) {
    console.log("Skipping release asset (--no-archive).");
    return;
  }
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

const importName = (name: JMnedictWord, s: NameStmts): void => {
  s.insWord.run(name.id);

  for (let i = 0; i < name.kanji.length; i++) {
    const k = name.kanji[i];
    s.insKanji.run(name.id, i, k.text);
    s.insTerm.run(
      name.id,
      "kanji",
      k.text,
      k.text.toLowerCase(),
      i === 0 ? 1 : 0
    );
  }
  for (let i = 0; i < name.kana.length; i++) {
    const k = name.kana[i];
    s.insKana.run(name.id, i, k.text, JSON.stringify(k.appliesToKanji));
    s.insTerm.run(
      name.id,
      "kana",
      k.text,
      k.text.toLowerCase(),
      i === 0 ? 1 : 0
    );
    const romaji = toRomaji(k.text);
    if (romaji !== "" && romaji !== k.text) {
      s.insTerm.run(name.id, "romaji", romaji, romaji.toLowerCase(), 0);
    }
  }
  for (let i = 0; i < name.translation.length; i++) {
    const t = name.translation[i];
    const texts = t.translation.map((tt) => tt.text);
    s.insTrans.run(name.id, i, JSON.stringify(t.type), JSON.stringify(texts));
    // Index each word of each translation so an English query ("Tanaka") finds the name.
    const words = new Set(
      texts
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((w) => w.length > 1)
    );
    for (const w of words) {
      s.insTerm.run(name.id, "trans", w, w, 0);
    }
  }
};

/**
 * Remove a half-written database so a failed build leaves nothing that looks usable.
 *
 * Any mid-build failure — a source host blipping, or the coverage gate rejecting the output — used to
 * leave a partial .db plus its WAL on disk, and `verify-db` PASSES on one of those: it checks that
 * the file answers, carries the right schema version and has non-empty tables, none of which a
 * half-built database fails. In development the workspace copy is read directly, so the next F5 run
 * would have queried it.
 *
 * Since builds now write to a STAGING path (see `staged`), this removes that rather than the live
 * database — a failed build leaves the last good DB in place instead of destroying it.
 */
const discardPartial = (path: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    // Never throw: this runs INSIDE the failure handler, so an exception here replaces the error
    // that actually killed the build with a cleanup error, and the real cause is lost. `force`
    // covers a missing file but not EPERM — on Windows the file stays locked while the extension
    // host or a test worker has it open, which is exactly when you most need the original message.
    try {
      rmSync(`${path}${suffix}`, { force: true });
    } catch (error) {
      console.error(`could not remove ${path}${suffix}:`, error);
    }
  }
};

console.time("build-data");
try {
  if (NAMES) {
    await buildNamesDatabase();
  } else {
    const sources = await downloadSources();
    await buildDatabase(sources);
  }
} catch (error) {
  // A blocked promote is the one failure that must NOT discard its output: the database is finished
  // and correct, only the swap is waiting on a file lock. Deleting it would cost another full
  // rebuild to recover something already sitting on disk.
  if (error instanceof PromoteBlocked) {
    console.error(`\n${error.message}`);
    throw error;
  }
  const partial = staged(NAMES ? NAMES_DB : OUT_DB);
  discardPartial(partial);
  console.error(
    `build-data failed; removed the partial database at ${partial}`
  );
  throw error;
}
console.timeEnd("build-data");
