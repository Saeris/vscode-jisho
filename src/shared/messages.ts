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

/**
 * One character as China, Hong Kong, Taiwan and Japan write it (spec 22): the forms, which of them
 * share a glyph or a code point, each form's stroke count and list level, and Japan's old form.
 */
export interface RegionalGroupDto {
  /** The group's name, usually its traditional form. */
  key: string;
  /** The forms of China, Hong Kong, Taiwan and Japan, in that order. */
  chars: string[];
  /** Japan's pre-reform form, when Japan writes a reformed one (眞 for 真). */
  old?: string;
  /**
   * Which forms share a glyph, as a partition of (cn, hk, tw, jp), plus a fifth digit for `old`:
   * the same digit, the same glyph. `"0123"` is four shapes; `"0010"` is Taiwan's alone differing.
   */
  glyphSig: string;
  /** The same partition of (cn, hk, tw, jp), by code point. */
  cpSig: string;
  /** Stroke counts of (cn, hk, tw, jp), then `old`'s; null where no source counts the form. */
  strokes: Array<number | null>;
  /**
   * List levels of (cn, hk, tw, jp): China 1–3, Hong Kong 1, Taiwan 1 (common) or 2 (less common),
   * Japan 1 (jōyō) or 2 (kyōiku). 0 when the region's list does not enter the form.
   */
  tiers: number[];
  /**
   * How each of (cn, hk, tw, jp) reads its form: Mandarin, Cantonese (Jyutping), Mandarin, and
   * Japan's on and kun readings. Null where no source gives one.
   */
  readings: Array<string | null>;
  /**
   * Each of (cn, hk, tw, jp)'s frequency rank for its form, in its own corpus (1 = most frequent).
   * Four corpora, never one scale. Null where the corpus does not rank the form.
   */
  ranks: Array<number | null>;
}

/**
 * One stroke-order drawing of a kanji's regional group (spec 22, phase 4), and the columns it shows:
 * 0–3 the regions (China, Hong Kong, Taiwan, Japan), 4 Japan's old form. Columns that take the
 * same strokes in the same order share one drawing; a form with no drawing has `svg: null`, so the
 * view can say so rather than show another region's order.
 */
export interface RegionalDrawingDto {
  columns: number[];
  /** The form drawn. */
  char: string;
  svg: string | null;
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

/** One remembered lookup, for the empty search view's history (#17). */
export interface RecentSearchDto {
  /** The text to re-run when tapped. */
  query: string;
  /** What the user opened — the label, when it differs from what they typed. */
  headword: string;
  /** Epoch millis; the list is already sorted most-recent-first. */
  at: number;
}

/** The recent-search history, most-recent-first. Every recent-search request answers with it. */
interface RecentSearches {
  recent: RecentSearchDto[];
}

/**
 * Every request the webview makes, and what the host answers — each described ONCE.
 *
 * `request` is what the webview sends besides `type` and `requestId`; `response` is what the host
 * answers besides those two. The `Request` and `Response` unions, the bridge's `request()` and the
 * host's `Handlers` table are all derived from this.
 *
 * A request type used to be described in five places — a request interface, a response interface,
 * two union lists and a bridge function, plus the host's routing — and nothing tied an answer to its
 * request: the host could answer `search` with a `getWord` shape, and only a runtime check in the
 * webview would notice (audit I-3). Now a new request is one entry here and one handler, and a
 * mismatched answer does not compile.
 */
export interface Protocol {
  search: {
    request: { query: string };
    response: {
      results: SearchResultDto[];
      /** Kanji matching the query, shown as a separate section. */
      kanji: KanjiResultDto[];
      /**
       * Morphological breakdown of the query — present only when a Japanese query tokenized into
       * more than one content segment. The UI shows these as tappable chips; tapping re-searches a
       * segment's lemma. Empty for single-word, English, or romaji queries.
       */
      segments: SegmentDto[];
    };
  };
  getWord: {
    request: { id: string };
    /** `null` when the id is unknown. */
    response: { word: WordDetailDto | null };
  };
  /** The fuller Tatoeba example pool for a word (F1 "more examples" page). */
  getMoreExamples: {
    request: { id: string };
    /** `null` when the word has no pooled examples. */
    response: { examples: MoreExamplesDto | null };
  };
  /** One classifier's words, for the browse list (#54) and `#tag` search (#27). */
  browse: {
    request: {
      /** A `Classifier.id` — the same token the `#tag` syntax accepts. */
      id: string;
      order: "frequency" | "gojuon";
    };
    response: {
      /** Empty when the classifier has no words in this build — a truthful answer, not an error. */
      results: SearchResultDto[];
      /**
       * Kanji rows, for `#kanji`. A result-type classifier selects a KIND of result, so its list is
       * characters rather than words — these are separate arrays rather than a union because the
       * view renders each with a different component, and every other classifier fills only
       * `results`.
       */
      kanji: KanjiResultDto[];
      /** Name rows, for `#name`/`#place`. Empty unless one of those tags opened the list. */
      names: NameResultDto[];
      /** The whole category's size, which `results` may be capped below. */
      total: number;
    };
  };
  /**
   * One kanji browse list (#55) — a JLPT level, a school grade, or the frequency-ranked set.
   *
   * Its own request rather than a `browse` with a different id: kanji lists are a SEPARATE taxonomy
   * from the word classifiers (they filter characters, not words), and sending a `KanjiListId` where
   * a `Classifier.id` is expected would blur the boundary that keeps a kanji-only filter out of
   * `#tag` search, where it could never match.
   */
  kanjiList: {
    request: {
      /** A `KanjiListId` from shared/classifiers. */
      id: string;
    };
    /** Empty when the id is unknown — a truthful answer rather than an error. */
    response: { kanji: KanjiResultDto[] };
  };
  /**
   * Word counts for every classifier, so the browse tree can show how big each category is.
   *
   * One request for all of them rather than one per category: the tree renders ~90 counts at once,
   * and 90 round trips over the webview bridge to fill in numbers would be visibly slow.
   */
  browseCounts: {
    request: {
      /**
       * Classifier ids already applied. Counts are then how many words would REMAIN if each
       * candidate were added — which is what lets the tag autocomplete hide combinations that narrow
       * to zero. Omitted (or empty) gives each category's own size, which is what the browse tree
       * shows.
       */
      applied?: string[];
    };
    response: {
      /** `Classifier.id` → word count. Absent ids have no words. */
      counts: Record<string, number>;
      /**
       * Whether the names dictionary is provisioned.
       *
       * `#name`/`#place` are hidden when it is not: they are backed by a separate ~400MB opt-in
       * download, and a suggestion that cannot return anything is worse than one that is absent.
       * Reported here rather than in the settings snapshot because it changes when a DOWNLOAD
       * completes, not when configuration does.
       */
      namesAvailable: boolean;
      /**
       * Whether to offer the names dictionary: it is not installed, and the user has not declined
       * it.
       *
       * Names are OPT-IN. Nothing provisions them except the user accepting this offer (or
       * installing from About) — they used to download on the first search of anything, 84 MB and
       * ~400 MB on disk, while the README promised "if you use name lookups" (audit I-0).
       */
      namesOffered: boolean;
    };
  };
  getKanji: {
    request: { literal: string };
    /** `null` when the literal isn't in Kanjidic. */
    response: { kanji: KanjiDetailDto | null };
  };
  /** Stroke-order animation SVG for a kanji (kanji detail's stroke player). */
  getStrokeSvg: {
    request: { literal: string };
    /** Raw SVG markup, or `null` when no stroke animation exists for the literal. */
    response: { svg: string | null };
  };
  getComponentTree: {
    request: { literal: string };
    /** The recursive tree, or `null` when the kanji has no meaningful decomposition. */
    response: { tree: ComponentTreeDto | null };
  };
  /**
   * A kanji's regional forms (spec 22): the groups in which it is Japan's form or Japan's old form.
   * Usually one; several when Japan writes several characters alike (弁 stands for 辨, 瓣, 辯, 辦).
   */
  getRegionalForms: {
    request: { literal: string };
    response: { groups: RegionalGroupDto[] };
  };
  /**
   * Stroke order by region (spec 22, phase 4): the distinct drawings of the kanji's own regional
   * group, Japan's first. Empty when the kanji is in no group.
   */
  getRegionalStrokes: {
    request: { literal: string };
    response: { drawings: RegionalDrawingDto[] };
  };
  /** Radical picker: the current selection (empty = show all radicals, no matches). */
  lookupRadicals: {
    request: { selected: string[] };
    response: { result: RadicalLookupDto };
  };
  /**
   * Hydrate a set of kanji literals into result rows.
   *
   * For the handwriting recognizer, whose candidates come from the in-webview recognizer as bare
   * characters — it never touches the host, so it is the one kanji list with no meanings to show.
   * The response preserves the order asked for, because that order is the recognizer's ranking.
   */
  getKanjiPreviews: {
    request: { literals: string[] };
    /** In the order requested. Literals with no Kanjidic entry are omitted rather than nulled. */
    response: { results: KanjiResultDto[] };
  };
  /** Dictionary provenance/attribution for the About view, from the DB's `meta` table. */
  getAbout: {
    request: Empty;
    /** Key/value provenance from the DB `meta` table (source, dictDate, license, wordCount, …). */
    response: { meta: Record<string, string> };
  };
  /**
   * Name search against the optional JMnedict database. Separate from `search` because the names DB
   * is a separate, opt-in download — the word/kanji search never waits on it.
   */
  searchNames: {
    request: { query: string };
    /** Empty when the query has no name matches, or the names DB isn't installed. */
    response: { names: NameResultDto[] };
  };
  getName: {
    request: { id: string };
    /** `null` when the id is unknown. */
    response: { name: NameDetailDto | null };
  };
  /** Install the names dictionary: the user accepted the offer. Downloads it with a progress notice. */
  installNames: { request: Empty; response: Empty };
  /** The user declined the names offer under search results. Remembered across windows. */
  declineNames: { request: Empty; response: Empty };
  /**
   * Act on the dictionary from the panel: the recovery each failure needs.
   *   - `retry`: try to download or open it again (offline, or any other failure).
   *   - `update`: run the dictionary update check (an older schema).
   *   - `updateJisho`: open Jisho's page in the Extensions view (a newer schema needs a newer Jisho).
   */
  dictionaryAction: {
    request: { action: "retry" | "update" | "updateJisho" };
    response: Empty;
  };
  /**
   * File a crash report from the webview.
   *
   * The stack is sanitized on THIS side before it crosses, so the host never receives the user's
   * directory layout even in a log. See `shared/diagnostics.ts`.
   */
  reportCrash: {
    request: {
      message: string;
      /**
       * Sanitized on the WEBVIEW side, and absent for a non-crash report.
       *
       * A failed query rejects with a stack describing the bridge's own plumbing rather than the
       * cause, so including it would put noise in the issue where the useful signal is the message
       * plus the diagnostics.
       */
      stack?: string;
    };
    response: Empty;
  };
  /**
   * The diagnostic snapshot, for the About view's copy button.
   *
   * Collected host-side because most of it is only reachable there (`process.versions`, the OS, the
   * `.version` sidecar). The webview renders and copies what it is given rather than assembling its
   * own, so all three report surfaces quote the same fields.
   */
  getDiagnostics: {
    request: Empty;
    /** Already rendered as Markdown: the webview copies this verbatim. */
    response: { markdown: string };
  };
  /** Open VS Code's Settings UI filtered to this extension's section (the sidebar's ⚙). */
  openSettings: { request: Empty; response: Empty };
  /**
   * Put text on the system clipboard. Routed through the host because a webview's
   * `navigator.clipboard` needs transient user activation and can be refused outright — the
   * extension host's clipboard API has neither constraint.
   */
  copyText: { request: { text: string }; response: Empty };
  /** Read the recent-search history. */
  getRecentSearches: { request: Empty; response: RecentSearches };
  /**
   * Record a lookup. Sent when the user OPENS a result, not as they type — the query text changes on
   * every keystroke, so recording that would remember every prefix of every search. Answers with the
   * full list, so the UI updates with no refetch.
   */
  recordRecentSearch: {
    request: { query: string; headword: string };
    response: RecentSearches;
  };
  /** Forget the history. Answers with the (empty) list, like the other two. */
  clearRecentSearches: { request: Empty; response: RecentSearches };
}

/** A request or answer with nothing besides `type` and `requestId`. */
type Empty = Record<never, never>;

/** A request's `type`. */
export type RequestType = keyof Protocol;

/** The request of one type, as it crosses the bridge. */
export type RequestOf<T extends RequestType> = {
  type: T;
  requestId: string;
} & Protocol[T]["request"];

/** The answer to one request type, as it crosses the bridge. */
export type ResponseOf<T extends RequestType> = {
  type: T;
  requestId: string;
} & Protocol[T]["response"];

/** Any request. */
export type Request = { [T in RequestType]: RequestOf<T> }[RequestType];

/**
 * What the host's handler for a request returns: the answer's own fields. `type` and `requestId` are
 * added for it, so a handler cannot label its answer as another request's.
 */
export type Answer<T extends RequestType> = Protocol[T]["response"];

/**
 * One handler per request type: the host's whole surface, checked against the protocol.
 *
 * A mapped type, so each handler is tied to its own request: the `search` handler receives a
 * `search` request and must return a `search` answer. A protocol entry with no handler, or a handler
 * whose answer is another request's shape, does not compile.
 */
export type Handlers = {
  [T in RequestType]: (request: RequestOf<T>) => Promise<Answer<T>>;
};

export interface ErrorResponse {
  type: "error";
  requestId: string;
  message: string;
  /**
   * Why, when the cause is the dictionary's STATE rather than a bug — so the webview can offer the
   * recovery that fits instead of treating every failure as something to report (audit SM-10).
   * Absent for anything else.
   */
  code?: DictionaryErrorCode;
}

// ── The dictionary's lifecycle (host/lifecycle.ts) ───────────────────────────

/** Why a dictionary failed, each with its own recovery in the panel. */
export type FailureReason =
  /** The download could not reach the release. Retrying fixes it. */
  | "offline"
  /** The file is an older schema than this build reads. Updating the dictionary fixes it. */
  | "schema-older"
  /** The file is a newer schema than this build reads. Only a newer Jisho fixes it. */
  | "schema-newer"
  /** Anything else about opening the file. */
  | "io";

/** A failed request's cause, when it is the dictionary's state. */
export type DictionaryErrorCode = FailureReason | "not-ready";

/** Where one dictionary is in its lifecycle. */
export type DictionaryStatus =
  | { state: "absent" }
  | { state: "downloading"; percent: number }
  | { state: "opening" }
  /** Open and serving. `updating` is the progress of a newer copy downloading behind it. */
  | { state: "ready"; updating?: number }
  /** Closing the old file and opening the new one — well under a second. Requests wait. */
  | { state: "swapping" }
  | { state: "failed"; reason: FailureReason; message: string };

/**
 * Both dictionaries' state, pushed on every change.
 *
 * The webview used to have no idea any of this existed: on first run it showed "Searching…" for the
 * whole 119 MB download, and every failure looked like a bug (audit SM-10).
 */
export interface DictionaryStatusPush {
  type: "dictionaryStatus";
  words: DictionaryStatus;
  names: DictionaryStatus;
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

/** Any answer — including the error a failed request gets instead of its own. */
export type Response =
  | { [T in RequestType]: ResponseOf<T> }[RequestType]
  | ErrorResponse;
