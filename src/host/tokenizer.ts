/**
 * Japanese morphological analysis via Lindera (Vibrato/MeCab-quality). Wraps the `lindera-nodejs`
 * NAPI binding (through the `vendor/lindera-nodejs` loader shim — the published package is broken,
 * see docs/specs/14) behind a small typed service. Lazy-initialized via a dynamic `import()`: the
 * native addon load + IPADIC dictionary read (~200ms) are paid on the first Japanese query, never
 * at activation.
 *
 * We own this integration layer (POS normalization, サ変-compound coalescing, the Segment DTO); the
 * lattice algorithm itself is Lindera's. The IPADIC dictionary is NOT embedded (unlike the old WASM
 * package) — it's a compiled directory shipped in `assets/lindera-ipadic/` and loaded by path, so
 * `configureTokenizer(dictPath)` must run once (from activation) before the first `segment()`.
 * A `lindera-nodejs` token's fields are getters and its IPADIC features are a positional `details`
 * array (see `lindera.d.ts`), not the flat fields the old WASM binding exposed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Tokenizer as LinderaTokenizer } from "../../vendor/lindera-nodejs/index.mjs";
import type { PartOfSpeech, SegmentDto } from "../shared/messages";

/** A built tokenizer instance (the class is a value; this is its instance type). */
type Tokenizer = InstanceType<typeof LinderaTokenizer>;

/** Map IPADIC's Japanese part-of-speech tags to the small enum the UI colors. */
const POS_MAP: Record<string, PartOfSpeech> = {
  名詞: "noun",
  動詞: "verb",
  形容詞: "adjective",
  副詞: "adverb",
  助詞: "particle",
  助動詞: "auxiliary",
  連体詞: "adjective", // prenominal adjectivals — group with adjectives for coloring
  接続詞: "other",
  感動詞: "other",
  記号: "other",
  フィラー: "other",
  接頭詞: "other"
};

const toPartOfSpeech = (tag: string): PartOfSpeech => POS_MAP[tag] ?? "other";

let cached: Promise<Tokenizer> | undefined;
let dictPath: string | undefined;

/**
 * Point the tokenizer at the compiled IPADIC dictionary directory (bundled in `assets/lindera-ipadic`).
 * Must be called once from activation before the first `segment()`/`warmTokenizer()`. Idempotent
 * until the tokenizer is built — the path is only read on first construction.
 */
export const configureTokenizer = (compiledDictDir: string): void => {
  dictPath = compiledDictDir;
};

/**
 * Build the tokenizer once and reuse. Loaded via dynamic `import()` (not a top-level import) so the
 * native addon + IPADIC dictionary are resident only once a Japanese query needs them. Reads the
 * dictionary from the path set by `configureTokenizer`; falls back to the repo `assets/` copy so
 * unit tests (which never call `configureTokenizer`) resolve the dev dictionary.
 */
const getTokenizer = async (): Promise<Tokenizer> => {
  cached ??= (async (): Promise<Tokenizer> => {
    const lindera = await import("../../vendor/lindera-nodejs/index.mjs");
    // Dev/test fallback: the repo-local compiled dictionary (produced/vendored under assets/).
    const dir = dictPath ?? join(process.cwd(), "assets", "lindera-ipadic");
    const dictionary = lindera.loadDictionary(dir);
    // Layer our slang user-dictionary (colloquial words IPADIC lacks — きもい, うざい, エモい) if it
    // was provisioned next to the compiled dict; degrade gracefully if it isn't present/loadable.
    const csv = join(dir, "slang-userdict.csv");
    let userDict = null;
    if (existsSync(csv)) {
      try {
        userDict = lindera.loadUserDictionary(csv, new lindera.Metadata());
      } catch {
        userDict = null; // slang words just fall back to their shattered segmentation
      }
    }
    return new lindera.Tokenizer(dictionary, "normal", userDict);
  })();
  return cached;
};

/**
 * Start building the tokenizer without waiting for it.
 *
 * `search` awaits the tokenizer BEFORE querying the database (the lemmas refine ranking), so a
 * cold tokenizer delays word results while the names query — which never tokenizes — answers
 * immediately. That asymmetry is visible as names appearing first on the first Japanese search.
 *
 * Measured cold: 23ms to load/instantiate the WASM, 192ms to build, ~4ms for the first tokenize.
 * Moving that ~220ms off the first query and into activation makes the tokenizer usually ready by
 * the time anyone types. It is fire-and-forget: failures surface on the real call, which has to
 * handle them anyway.
 */
export const warmTokenizer = async (): Promise<void> => {
  try {
    await getTokenizer();
  } catch {
    // Swallowed deliberately: this is speculative work with no caller to report to. A genuine
    // failure re-throws from `segment()` where a user is actually waiting on it.
  }
};

/**
 * Segment Japanese text into meaningful units with part of speech and dictionary form.
 *
 * IPADIC splits サ変 compounds (勉強+する) and verb+auxiliary chains (食べ+まし+た). We coalesce
 * trailing する / auxiliaries / inflectional suffixes into their preceding content word so a
 * "segment" is a searchable unit (勉強する stays one verb segment, not 勉強 + し + ます). The
 * segment's `lemma` is the content word's dictionary form — what a search should look up.
 */
/** One raw morpheme inside a (possibly folded) segment. */
export interface MorphemeDto {
  surface: string;
  lemma: string;
  /** Katakana reading, or "" when the dictionary has none (unknown words, symbols). */
  reading: string;
  pos: PartOfSpeech;
}

/** A segment plus the raw morphemes folded into it — the hover's conjugation breakdown reads
    these; the search/breakdown-bar consumers ignore them. */
export interface DetailedSegment extends SegmentDto {
  parts: MorphemeDto[];
}

// IPADIC feature layout in a `lindera-nodejs` token's `details` array. `*` marks an absent value.
const IPADIC_POS = 0;
const IPADIC_SUBCATEGORY1 = 1;
const IPADIC_BASE_FORM = 6;
const IPADIC_READING = 7;

/** A details entry, or "" when the field is absent ("*") or the index isn't present. `.at()` is
    used deliberately so an out-of-bounds index is typed (and handled) as `undefined`. */
const feature = (details: readonly string[], index: number): string => {
  const value = details.at(index);
  return value === undefined || value === "*" ? "" : value;
};

export const segment = async (text: string): Promise<DetailedSegment[]> => {
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(text);
  const segments: DetailedSegment[] = [];
  for (const token of tokens) {
    const { details, surface } = token;
    const pos = toPartOfSpeech(feature(details, IPADIC_POS));
    const baseForm = feature(details, IPADIC_BASE_FORM);
    const subcategory1 = feature(details, IPADIC_SUBCATEGORY1);
    const morpheme: MorphemeDto = {
      surface,
      lemma: baseForm === "" ? surface : baseForm,
      reading: feature(details, IPADIC_READING),
      pos
    };
    // Explicit length guard so `prev` is genuinely defined-or-undefined (index access is
    // otherwise typed non-null with noUncheckedIndexedAccess off).
    const prev =
      segments.length > 0 ? segments[segments.length - 1] : undefined;
    // Fold auxiliaries and suffixal する / inflectional suffixes onto the previous content
    // segment, so a "segment" is a searchable unit (勉強する, not 勉強 + し + ます).
    const isSuffix =
      pos === "auxiliary" ||
      baseForm === "する" ||
      subcategory1 === "接尾" ||
      subcategory1 === "非自立";
    if (isSuffix && prev && prev.pos !== "particle") {
      prev.surface += surface;
      // The reading has to grow with the surface: furigana alignment reads the WHOLE segment
      // (見せました needs ミセマシタ, not the head's ミセ), and a short reading would make every
      // conjugated verb fail to align.
      prev.reading += morpheme.reading;
      prev.parts.push(morpheme);
      // Promote noun + する → verb (サ変); otherwise keep the content word's lemma/pos.
      if (prev.pos === "noun" && baseForm === "する") prev.pos = "verb";
      continue;
    }
    segments.push({
      surface,
      lemma: morpheme.lemma,
      reading: morpheme.reading,
      pos,
      parts: [morpheme]
    });
  }
  return segments;
};

/** Number of *content* (searchable) segments — used to decide whether to show a breakdown. */
export const contentSegmentCount = (segments: SegmentDto[]): number =>
  segments.filter((s) => s.pos !== "particle" && s.pos !== "auxiliary").length;
