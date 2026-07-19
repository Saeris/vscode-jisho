/**
 * Japanese morphological analysis via Lindera (Vibrato/MeCab-quality, compiled to WASM). Wraps the
 * `lindera-wasm-nodejs-ipadic` package — which embeds the IPADIC dictionary and loads its WASM when
 * imported — behind a small typed service. Lazy-initialized via a dynamic `import()`: the WASM and
 * the ~200ms builder cost are paid on the first Japanese query, never at activation.
 *
 * We own this integration layer (POS normalization, サ変-compound coalescing, the Segment DTO); the
 * lattice algorithm itself is Lindera's. The `.wasm` is read from the package dir at runtime, so
 * lindera ships unbundled in node_modules (see vite.config `pack.deps` + `.vscodeignore`). Its
 * token shape is declared in `lindera.d.ts`.
 */
import type { Tokenizer } from "lindera-wasm-nodejs-ipadic";
import type { PartOfSpeech, SegmentDto } from "../shared/messages";

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

/**
 * Build the tokenizer once and reuse. Loaded via dynamic `import()` (not a top-level import) so
 * the WASM + ~188MB IPADIC dictionary are resident only once a Japanese query needs them.
 */
const getTokenizer = async (): Promise<Tokenizer> => {
  cached ??= (async (): Promise<Tokenizer> => {
    const { TokenizerBuilder } = await import("lindera-wasm-nodejs-ipadic");
    const builder = new TokenizerBuilder();
    builder.setDictionary("embedded://ipadic");
    builder.setMode("normal");
    return builder.build();
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

/** Whether the tokenizer has finished building — i.e. `segment()` will not pay init cost. */
export const tokenizerStarted = (): boolean => cached !== undefined;

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

export const segment = async (text: string): Promise<DetailedSegment[]> => {
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(text);
  const segments: DetailedSegment[] = [];
  for (const token of tokens) {
    const pos = toPartOfSpeech(token.partOfSpeech);
    const morpheme: MorphemeDto = {
      surface: token.surface,
      lemma: token.baseForm === "*" ? token.surface : token.baseForm,
      reading: token.reading === "*" ? "" : token.reading,
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
      token.baseForm === "する" ||
      token.partOfSpeechSubcategory1 === "接尾" ||
      token.partOfSpeechSubcategory1 === "非自立";
    if (isSuffix && prev && prev.pos !== "particle") {
      prev.surface += token.surface;
      // The reading has to grow with the surface: furigana alignment reads the WHOLE segment
      // (見せました needs ミセマシタ, not the head's ミセ), and a short reading would make every
      // conjugated verb fail to align.
      prev.reading += morpheme.reading;
      prev.parts.push(morpheme);
      // Promote noun + する → verb (サ変); otherwise keep the content word's lemma/pos.
      if (prev.pos === "noun" && token.baseForm === "する") prev.pos = "verb";
      continue;
    }
    segments.push({
      surface: token.surface,
      lemma: morpheme.lemma,
      reading: token.reading === "*" ? "" : token.reading,
      pos,
      parts: [morpheme]
    });
  }
  return segments;
};

/** Number of *content* (searchable) segments — used to decide whether to show a breakdown. */
export const contentSegmentCount = (segments: SegmentDto[]): number =>
  segments.filter((s) => s.pos !== "particle" && s.pos !== "auxiliary").length;
