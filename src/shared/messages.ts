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

/** Dictionary provenance/attribution for the About view, from the DB's `meta` table. */
export interface GetAboutRequest {
  type: "getAbout";
  requestId: string;
}

export type Request =
  | SearchRequest
  | GetWordRequest
  | GetKanjiRequest
  | GetAboutRequest;

export interface SearchResponse {
  type: "search";
  requestId: string;
  results: SearchResultDto[];
  /** Kanji matching the query, shown as a separate section. */
  kanji: KanjiResultDto[];
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
  | GetAboutResponse
  | ErrorResponse;
