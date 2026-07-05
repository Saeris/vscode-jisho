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

export type Request = SearchRequest | GetWordRequest;

export interface SearchResponse {
  type: "search";
  requestId: string;
  results: SearchResultDto[];
}

export interface GetWordResponse {
  type: "getWord";
  requestId: string;
  /** `null` when the id is unknown. */
  word: WordDetailDto | null;
}

export interface ErrorResponse {
  type: "error";
  requestId: string;
  message: string;
}

export type Response = SearchResponse | GetWordResponse | ErrorResponse;
