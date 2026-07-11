/**
 * The contract between the extension host and the webview.
 *
 * Both sides import this module. Everything here must be a plain, structured-clone-safe
 * object (no Map/Set/Date/functions) — VSCode's webview `postMessage` serializes with a
 * restricted clone, so DTOs are JSON-shaped by construction.
 *
 * Protocol: the webview sends a `Request` with a unique `requestId`; the host replies with a
 * `Response` carrying the same `requestId`. This 1:1 correlation is what lets the webview's
 * bridge resolve the matching promise (consumed as a TanStack Query `queryFn`).
 */

// ── DTOs ────────────────────────────────────────────────────────────────────

/** A single kanji (non-kana) writing of a word. */
export interface KanjiDto {
  text: string;
  common: boolean;
  tags: string[];
}

/** A single kana reading of a word. */
export interface KanaDto {
  text: string;
  common: boolean;
  tags: string[];
  /** Kanji writings this reading applies to; `["*"]` means all. */
  appliesToKanji: string[];
}

/** A tag rendered for display: its code plus human-readable description. */
export interface TagDto {
  code: string;
  description: string;
}

/** One sense (meaning group): glosses plus grammatical/usage metadata. */
export interface SenseDto {
  partOfSpeech: TagDto[];
  field: TagDto[];
  misc: TagDto[];
  info: string[];
  dialect: TagDto[];
  /** English glosses (translations) for this sense, in source order. */
  glosses: string[];
  appliesToKanji: string[];
  appliesToKana: string[];
  /** Cross-references (related words), as their surface strings. */
  related: string[];
  antonym: string[];
}

/** Normalized part of speech, for coloring the query breakdown. */
export type PartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "particle"
  | "auxiliary"
  | "other";

/** One segment of a tokenized query, for the multi-word breakdown bar. */
export interface SegmentDto {
  /** The surface text as it appears in the query (inflected). */
  surface: string;
  /** Dictionary form — what tapping the segment searches for. */
  lemma: string;
  /** Katakana reading, or "" when unknown. */
  reading: string;
  pos: PartOfSpeech;
}

/** A compact result for the search list. */
export interface SearchResultDto {
  id: string;
  /** Primary headword to show (first kanji writing, else first kana). */
  headword: string;
  /** Primary reading to show under/next to the headword (first kana). */
  reading: string;
  common: boolean;
  /** A short gloss preview (first sense's first gloss). */
  glossPreview: string;
}

/** The full word detail. */
export interface WordDetailDto {
  id: string;
  common: boolean;
  kanji: KanjiDto[];
  kana: KanaDto[];
  senses: SenseDto[];
}

/** A compact kanji result for the search list's "Kanji" section. */
export interface KanjiResultDto {
  literal: string;
  strokeCount: number | null;
  grade: number | null;
  jlpt: number | null;
  /** First meaning, on-reading, kun-reading for the preview row. */
  meaningPreview: string;
  onPreview: string;
  kunPreview: string;
}

/** A word that contains a given kanji, for the kanji detail's "words" section. */
export interface KanjiWordDto {
  id: string;
  headword: string;
  reading: string;
  glossPreview: string;
}

/** A selectable radical in the radical picker, and which selections it would still allow. */
export interface RadicalDto {
  radical: string;
  strokeCount: number;
}

/** The radical picker's data: all radicals, plus the kanji matching the current selection. */
export interface RadicalLookupDto {
  /** All radicals, ordered by stroke count then radical. */
  radicals: RadicalDto[];
  /**
   * Radicals still reachable given the current selection (their addition keeps the match set
   * non-empty). Empty when nothing is selected — meaning "all enabled". Lets the UI grey out
   * radicals that would yield no results.
   */
  enabled: string[];
  /** Kanji containing every selected radical, ordered by frequency (common first). */
  matches: KanjiResultDto[];
}

/** The full kanji detail. */
export interface KanjiDetailDto {
  literal: string;
  grade: number | null;
  strokeCount: number | null;
  frequency: number | null;
  jlpt: number | null;
  on: string[];
  kun: string[];
  meanings: string[];
  nanori: string[];
  /** Component characters/radicals (Kradfile). */
  components: string[];
  /** Common words containing this kanji. */
  words: KanjiWordDto[];
}

// ── Request / Response protocol ───────────────────────────────────────────────

export interface SearchRequest {
  type: "search";
  requestId: string;
  query: string;
}

export interface GetWordRequest {
  type: "getWord";
  requestId: string;
  id: string;
}

export interface GetKanjiRequest {
  type: "getKanji";
  requestId: string;
  literal: string;
}

/** Radical picker: the current selection (empty = show all radicals, no matches). */
export interface LookupRadicalsRequest {
  type: "lookupRadicals";
  requestId: string;
  selected: string[];
}

/** Dictionary provenance/attribution for the About view, from the DB's `meta` table. */
export interface GetAboutRequest {
  type: "getAbout";
  requestId: string;
}

export type Request =
  | SearchRequest
  | GetWordRequest
  | GetKanjiRequest
  | LookupRadicalsRequest
  | GetAboutRequest;

export interface SearchResponse {
  type: "search";
  requestId: string;
  results: SearchResultDto[];
  /** Kanji matching the query, shown as a separate section. */
  kanji: KanjiResultDto[];
  /**
   * Morphological breakdown of the query — present only when a Japanese query tokenized into more
   * than one content segment. The UI shows these as tappable chips; tapping re-searches a
   * segment's lemma. Empty for single-word, English, or romaji queries.
   */
  segments: SegmentDto[];
}

export interface GetWordResponse {
  type: "getWord";
  requestId: string;
  /** `null` when the id is unknown. */
  word: WordDetailDto | null;
}

export interface GetKanjiResponse {
  type: "getKanji";
  requestId: string;
  /** `null` when the literal isn't in Kanjidic. */
  kanji: KanjiDetailDto | null;
}

export interface LookupRadicalsResponse {
  type: "lookupRadicals";
  requestId: string;
  result: RadicalLookupDto;
}

export interface GetAboutResponse {
  type: "getAbout";
  requestId: string;
  /** Key/value provenance from the DB `meta` table (source, dictDate, license, wordCount, …). */
  meta: Record<string, string>;
}

export interface ErrorResponse {
  type: "error";
  requestId: string;
  message: string;
}

export type Response =
  | SearchResponse
  | GetWordResponse
  | GetKanjiResponse
  | LookupRadicalsResponse
  | GetAboutResponse
  | ErrorResponse;
