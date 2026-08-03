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
  /**
   * Pitch accent pattern(s) for this reading as mora positions (0=heiban/flat, n=downstep after
   * mora n), ordered by commonness; empty when unknown. Source: Kanjium (NHK/Wadoku).
   */
  pitchAccents: number[];
}

/** A tag rendered for display: its code plus human-readable description. */
export interface TagDto {
  code: string;
  description: string;
}

/**
 * An example sentence, in the one form the DB stores and both example surfaces render.
 *
 * `jaFurigana` carries BOTH build-time layers: mirrordown ruby (`{漢字|かんじ}`) for furigana and
 * F1-links markup (`[word](pos:entseq)`) for tap-through. Neither is optional to handle — a consumer
 * that renders this as a plain string prints the markup, so it goes through `ExampleSentence`.
 */
export interface SentenceDto {
  jaFurigana: string;
  en: string;
}

/** One group of pooled examples: sentences attributed to a specific sense (with its gloss header). */
export interface ExampleGroupDto {
  /** The sense's first gloss, e.g. "to eat" — the section header. */
  gloss: string;
  sentences: SentenceDto[];
}

/**
 * The "more examples" page payload (F1): the fuller Tatoeba pool for a word. Sentences the source
 * tagged to a specific sense are grouped under that sense; the rest are the word-level pool.
 */
export interface MoreExamplesDto {
  /** The word's primary surface, for the page title. */
  headword: string;
  /** Per-sense example groups (only senses that have pooled sentences). */
  senses: ExampleGroupDto[];
  /** Word-level pool: sentences the source did not attribute to a sense. */
  wordLevel: SentenceDto[];
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
  /** Example sentences (Tanaka/Tatoeba) for this sense; empty when none. */
  sentences: SentenceDto[];
}

/**
 * Normalized part of speech, for coloring the query breakdown and the editor.
 *
 * Nine colour-bearing categories, grouped into the four semantic clusters the palette encodes
 * (docs/pos-palette-research.md). IPADIC can prove every one of them; `pronoun` is the single
 * subcategory read (`名詞,代名詞`, 5.06% of tokens — the 6th most common category overall).
 * `other` is punctuation, which stays uncoloured because its glyph shape already disambiguates it.
 */
export type PartOfSpeech =
  // things — entities
  | "pronoun"
  | "noun"
  // modifiers
  | "adnominal"
  | "adjective"
  | "adverb"
  // structure — divides and frames the sentence
  | "particle"
  | "utterance"
  // actions
  | "verb"
  | "auxiliary"
  // punctuation and anything unclassified
  | "other";

/** The semantic cluster a part of speech belongs to; hue is assigned per cluster. */
export type PosCluster =
  | "things"
  | "modifier"
  | "structure"
  | "actions"
  | "other";

export const POS_CLUSTER: Record<PartOfSpeech, PosCluster> = {
  pronoun: "things",
  noun: "things",
  adnominal: "modifier",
  adjective: "modifier",
  adverb: "modifier",
  particle: "structure",
  utterance: "structure",
  verb: "actions",
  auxiliary: "actions",
  other: "other"
};

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
  /** Word-level JLPT (5=N5 … 1=N1), or null. Unofficial community estimate (Waller/tanos). */
  jlpt: number | null;
}

/** The full word detail. */
export interface WordDetailDto {
  id: string;
  common: boolean;
  /** Word-level JLPT (5=N5 … 1=N1), or null. Unofficial community estimate (Waller/tanos). */
  jlpt: number | null;
  /**
   * How many sentences the "more examples" page holds for this word (the Tatoeba pool, which is
   * disjoint from the per-sense `sentences` above).
   *
   * Carried on the word so the page can decide whether to OFFER that link at all. Measured on the
   * shipped dictionary: 47.8% of words have an empty pool, so showing the link unconditionally sent
   * nearly half of all taps to a blank page.
   */
  poolExamples: number;
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
  /**
   * One of the seven positional categories (hen/tsukuri/kanmuri/ashi/kamae/tare/nyo), or null when
   * the source marks the character as its own radical — a real distinction, not missing data.
   */
  position: string | null;
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

/**
 * One component ("part") of a kanji, from Kradfile — a visual decomposition, not the 214 Kangxi
 * radicals. Some parts are stroke-shape stand-ins (ノ ハ マ ユ ヨ ｜) with no Kanjidic entry, so
 * `hasDetail` tells the UI whether a detail page exists (BACKLOG #30 has the full story).
 */
export interface ComponentDto {
  /** The component character as Kradfile writes it (possibly a JIS-encodable proxy). */
  literal: string;
  /** True when Kanjidic has an entry, i.e. a kanji detail page exists for it. */
  hasDetail: boolean;
}

/** A visually-similar kanji (F3): the character plus a one-word meaning for its tile. */
export interface SimilarKanjiDto {
  literal: string;
  /** The kanji's first Kanjidic meaning (e.g. "not yet"), or "" if none — a compact tile label. */
  meaning: string;
}

/**
 * A node in a kanji's recursive component tree (cjk-decomp). Each node is a real Kanjidic character
 * with a brief annotation, and its `children` are its direct components — the Jisho-style breakdown.
 */
export interface ComponentTreeDto {
  literal: string;
  /** First few meanings, for the annotation line (empty if none). */
  meaningPreview: string;
  /** On/kun readings joined for display (empty if none). */
  readingPreview: string;
  children: ComponentTreeDto[];
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
  /** Component characters/radicals (Kradfile), the flat parts list. */
  components: ComponentDto[];
  /**
   * Visually-similar kanji (F3), ranked most-similar-first. Each is a kanji with its own detail page
   * (tappable), carrying a short one-word meaning to distinguish it from a component at a glance.
   * Empty when no similarity data applies. Derived from Yencken's confusion data for jōyō kanji, a
   * component heuristic otherwise — an approximation, not curated confusable pairs.
   */
  similar: SimilarKanjiDto[];
  /**
   * Whether a recursive component tree (cjk-decomp) exists for this kanji — gates the "Component
   * tree" link on the detail. When false, only the flat `components` list is meaningful.
   */
  hasTree: boolean;
  /** Common words containing this kanji. */
  words: KanjiWordDto[];
}

/** A compact name result for the search list's "Names" section. */
export interface NameResultDto {
  id: string;
  /** Primary writing to show (first kanji, else first kana). */
  headword: string;
  /** Primary reading (first kana), or "" for kana-only names. */
  reading: string;
  /** Human-readable name types (surname, place, given name…), from the first translation. */
  types: string[];
  /** First translation preview (e.g. "Tanaka"). */
  translationPreview: string;
}

/** One translation group of a name: its type tags and translation strings. */
export interface NameTranslationDto {
  types: TagDto[];
  translations: string[];
}

/** The full name detail (a simplified word detail — no senses/pos/pitch). */
export interface NameDetailDto {
  id: string;
  kanji: string[];
  kana: string[];
  translations: NameTranslationDto[];
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

/** The fuller Tatoeba example pool for a word (F1 "more examples" page). */
export interface GetMoreExamplesRequest {
  type: "getMoreExamples";
  requestId: string;
  id: string;
}

export interface GetKanjiRequest {
  type: "getKanji";
  requestId: string;
  literal: string;
}

/** Stroke-order animation SVG for a kanji (kanji detail's stroke player). */
export interface GetStrokeSvgRequest {
  type: "getStrokeSvg";
  requestId: string;
  literal: string;
}

export interface GetComponentTreeRequest {
  type: "getComponentTree";
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

/**
 * Name search against the optional JMnedict database. Separate from `search` because the names DB
 * is a lazy, opt-in download provisioned only on first use — the word/kanji search never waits on it.
 */
export interface SearchNamesRequest {
  type: "searchNames";
  requestId: string;
  query: string;
}

export interface GetNameRequest {
  type: "getName";
  requestId: string;
  id: string;
}

/** Open VS Code's Settings UI filtered to this extension's section (the sidebar's ⚙). */
export interface OpenSettingsRequest {
  type: "openSettings";
  requestId: string;
}

/**
 * Put text on the system clipboard. Routed through the host because a webview's
 * `navigator.clipboard` needs transient user activation and can be refused outright — the
 * extension host's clipboard API has neither constraint.
 */
export interface CopyTextRequest {
  type: "copyText";
  requestId: string;
  text: string;
}

/** One remembered lookup, for the empty search view's history (#17). */
export interface RecentSearchDto {
  /** The text to re-run when tapped. */
  query: string;
  /** What the user opened — the label, when it differs from what they typed. */
  headword: string;
  /** Epoch millis; the list is already sorted most-recent-first. */
  at: number;
}

/** Read the recent-search history. */
export interface GetRecentSearchesRequest {
  type: "getRecentSearches";
  requestId: string;
}

/**
 * Record a lookup. Sent when the user OPENS a result, not as they type — the query text changes on
 * every keystroke, so recording that would remember every prefix of every search.
 */
export interface RecordRecentSearchRequest {
  type: "recordRecentSearch";
  requestId: string;
  query: string;
  headword: string;
}

/** Forget the history. */
export interface ClearRecentSearchesRequest {
  type: "clearRecentSearches";
  requestId: string;
}

export type Request =
  | SearchRequest
  | GetWordRequest
  | GetMoreExamplesRequest
  | GetKanjiRequest
  | GetStrokeSvgRequest
  | GetComponentTreeRequest
  | LookupRadicalsRequest
  | GetAboutRequest
  | SearchNamesRequest
  | GetNameRequest
  | OpenSettingsRequest
  | CopyTextRequest
  | GetRecentSearchesRequest
  | RecordRecentSearchRequest
  | ClearRecentSearchesRequest;

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

export interface GetMoreExamplesResponse {
  type: "getMoreExamples";
  requestId: string;
  /** `null` when the word has no pooled examples. */
  examples: MoreExamplesDto | null;
}

export interface GetKanjiResponse {
  type: "getKanji";
  requestId: string;
  /** `null` when the literal isn't in Kanjidic. */
  kanji: KanjiDetailDto | null;
}

export interface GetStrokeSvgResponse {
  type: "getStrokeSvg";
  requestId: string;
  /** Raw SVG markup, or `null` when no stroke animation exists for the literal. */
  svg: string | null;
}

export interface GetComponentTreeResponse {
  type: "getComponentTree";
  requestId: string;
  /** The recursive tree, or `null` when the kanji has no meaningful decomposition. */
  tree: ComponentTreeDto | null;
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

export interface SearchNamesResponse {
  type: "searchNames";
  requestId: string;
  /** Empty when the query has no name matches, or the names DB isn't available yet. */
  names: NameResultDto[];
}

export interface OpenSettingsResponse {
  type: "openSettings";
  requestId: string;
}

export interface CopyTextResponse {
  type: "copyText";
  requestId: string;
}

/**
 * The history, most-recent-first.
 *
 * One interface, three response types — the bridge correlates a reply by matching `type` against
 * the REQUEST's type, so a shared `"recentSearches"` type would fail that check on every call.
 * Every variant carries the full list, so a record or a clear updates the UI with no refetch.
 */
interface RecentSearchesPayload {
  requestId: string;
  recent: RecentSearchDto[];
}
export interface GetRecentSearchesResponse extends RecentSearchesPayload {
  type: "getRecentSearches";
}
export interface RecordRecentSearchResponse extends RecentSearchesPayload {
  type: "recordRecentSearch";
}
export interface ClearRecentSearchesResponse extends RecentSearchesPayload {
  type: "clearRecentSearches";
}

export interface GetNameResponse {
  type: "getName";
  requestId: string;
  /** `null` when the id is unknown. */
  name: NameDetailDto | null;
}

export interface ErrorResponse {
  type: "error";
  requestId: string;
  message: string;
}

// ── Host-initiated pushes (editor commands) ──────────────────────────────────

/**
 * A push from the host to the webview, outside the request/response correlation — editor commands
 * ("Look Up Selection", "Speak Selection") drive the webview through these.
 */
export interface HostPush {
  type: "hostPush";
  action: "search" | "speak";
  text: string;
}

/**
 * The webview's one fire-and-forget notification: its bridge is attached and pushes can be
 * delivered. The host queues pushes for a not-yet-resolved webview until this arrives.
 */
export interface WebviewReady {
  type: "webviewReady";
}

/**
 * Settings snapshot pushed host → webview: once on `webviewReady`, again whenever the user edits
 * the extension's section in VS Code's Settings UI.
 *
 * Most land as CSS variables or root attributes via `applySettings`, so the panel restyles with no
 * re-render. The ones that change rendered CONTENT rather than style (`tagLabels`, `colorExamples`)
 * are read by components through `useHostSettings` instead — CSS cannot swap 名詞 for "noun", nor
 * omit an attribute.
 */
export interface HostSettings {
  type: "hostSettings";
  settings: {
    /** Multiplier over VS Code's base font size for the whole panel. */
    textScale: number;
    /** Stroke-order guide arrows: clear of the stroke ("offset") or tracing it ("aligned"). */
    guideStyle: "offset" | "aligned";
    /**
     * Which part-of-speech palette to colour with. The three dichromacy palettes are built
     * natively for that vision type rather than adapted from the standard one, so they are a
     * genuine alternative rather than a degraded version (docs/pos-palette-research.md).
     */
    palette: "standard" | "protanopia" | "deuteranopia" | "tritanopia";
    /**
     * Grammar-tag pills: short English terms, or the Japanese grammatical terms. English is the
     * default because 名詞 is only compact if you already read it; the full JMdict description is
     * the tooltip either way.
     */
    tagLabels: "english" | "japanese";
    /**
     * Whether words in example sentences carry their part-of-speech colour.
     *
     * Separate from `highlighting.enabled`, which gates the decorations in the user's OWN Markdown
     * and plain-text files: that is a change to documents they are editing, so it is opt-in and
     * defaults off. Colour inside the panel is the extension's own surface — the breakdown bar and
     * the tag pills are already coloured unconditionally — so this defaults ON, and exists to turn
     * the examples back OFF for anyone who finds a fully-coloured sentence busy to read.
     */
    colorExamples: boolean;
  };
}

export type Response =
  | SearchResponse
  | GetWordResponse
  | GetMoreExamplesResponse
  | GetKanjiResponse
  | GetStrokeSvgResponse
  | GetComponentTreeResponse
  | LookupRadicalsResponse
  | GetAboutResponse
  | SearchNamesResponse
  | GetNameResponse
  | OpenSettingsResponse
  | CopyTextResponse
  | GetRecentSearchesResponse
  | RecordRecentSearchResponse
  | ClearRecentSearchesResponse
  | ErrorResponse;
