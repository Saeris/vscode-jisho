/**
 * TanStack Query options for the dictionary. Each wraps a bridge call so loading/error/caching are
 * declarative and the components never touch `postMessage` directly.
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  KanjiDetailDto,
  KanjiResultDto,
  MoreExamplesDto,
  NameDetailDto,
  ComponentTreeDto,
  NameResultDto,
  RadicalLookupDto,
  RecentSearchDto,
  SearchResultDto,
  SegmentDto,
  WordDetailDto
} from "../shared/messages";
import {
  browse,
  kanjiList,
  browseCounts,
  getAbout,
  getKanji,
  getMoreExamples,
  getName,
  getComponentTree,
  getRecentSearches,
  getStrokeSvg,
  getWord,
  getDiagnostics,
  getKanjiPreviews,
  lookupRadicals,
  searchNames,
  searchWords
} from "./bridge";

/** Search results grouped into the sections the UI renders. */
export interface SearchResults {
  words: SearchResultDto[];
  kanji: KanjiResultDto[];
  segments: SegmentDto[];
}

export const searchQuery = (
  query: string
): ReturnType<
  typeof queryOptions<SearchResults, Error, SearchResults, string[]>
> =>
  queryOptions({
    queryKey: ["search", query],
    queryFn: async () => {
      const response = await searchWords(query);
      return {
        words: response.results,
        kanji: response.kanji,
        segments: response.segments
      };
    },
    // An empty query has no results; don't round-trip to the host.
    enabled: query.trim().length > 0
  });

export const namesQuery = (
  query: string
): ReturnType<
  typeof queryOptions<NameResultDto[], Error, NameResultDto[], string[]>
> =>
  queryOptions({
    queryKey: ["names", query],
    queryFn: async () => (await searchNames(query)).names,
    // Only search names for non-empty queries. Kept separate from the word search so a names-DB
    // download (first use) never blocks word/kanji results.
    enabled: query.trim().length > 0
  });

export const nameQuery = (
  id: string
): ReturnType<
  typeof queryOptions<
    NameDetailDto | null,
    Error,
    NameDetailDto | null,
    string[]
  >
> =>
  queryOptions({
    queryKey: ["name", id],
    queryFn: async () => (await getName(id)).name
  });

export const kanjiQuery = (
  literal: string
): ReturnType<
  typeof queryOptions<
    KanjiDetailDto | null,
    Error,
    KanjiDetailDto | null,
    string[]
  >
> =>
  queryOptions({
    queryKey: ["kanji", literal],
    queryFn: async () => (await getKanji(literal)).kanji
  });

export const strokeSvgQuery = (
  literal: string
): ReturnType<
  typeof queryOptions<string | null, Error, string | null, string[]>
> =>
  queryOptions({
    queryKey: ["strokeSvg", literal],
    queryFn: async () => (await getStrokeSvg(literal)).svg
  });

export const componentTreeQuery = (
  literal: string
): ReturnType<
  typeof queryOptions<
    ComponentTreeDto | null,
    Error,
    ComponentTreeDto | null,
    string[]
  >
> =>
  queryOptions({
    queryKey: ["componentTree", literal],
    queryFn: async () => (await getComponentTree(literal)).tree
  });

export const wordQuery = (
  id: string
): ReturnType<
  typeof queryOptions<
    WordDetailDto | null,
    Error,
    WordDetailDto | null,
    string[]
  >
> =>
  queryOptions({
    queryKey: ["word", id],
    queryFn: async () => (await getWord(id)).word
  });

export const moreExamplesQuery = (
  id: string
): ReturnType<
  typeof queryOptions<
    MoreExamplesDto | null,
    Error,
    MoreExamplesDto | null,
    string[]
  >
> =>
  queryOptions({
    queryKey: ["moreExamples", id],
    queryFn: async () => (await getMoreExamples(id)).examples
  });

/**
 * One classifier's words (#54).
 *
 * Keyed on the order as well as the id, so switching between frequency and gojūon is a cache hit
 * on the way back rather than a refetch — the two orderings of a 2,000-row list are worth holding
 * both of.
 */
export const browseQuery = (
  id: string,
  order: "frequency" | "gojuon"
): ReturnType<
  typeof queryOptions<BrowseResult, Error, BrowseResult, string[]>
> =>
  queryOptions({
    queryKey: ["browse", id, order],
    queryFn: async () => {
      const response = await browse(id, order);
      return {
        results: response.results,
        kanji: response.kanji,
        names: response.names,
        total: response.total
      };
    }
  });

/** A browsed list: words for most classifiers, kanji for `#kanji`. Only one is ever populated. */
interface BrowseResult {
  results: SearchResultDto[];
  kanji: KanjiResultDto[];
  names: NameResultDto[];
  total: number;
}

/**
 * Word counts for the whole classifier tree.
 *
 * `staleTime: Infinity` — these change only when the dictionary itself is replaced, so refetching
 * them on every visit to the tree would be ~90 COUNT queries for an answer that cannot have moved.
 */
export const browseCountsQuery = (
  /**
   * Classifier ids already applied. With none, these are each category's own size (the browse
   * tree). With some, they are REFINING counts — how many words would remain if each candidate
   * were added — which is what the tag autocomplete needs to hide dead-end combinations.
   */
  applied: string[] = []
): ReturnType<
  typeof queryOptions<
    { counts: Record<string, number>; namesAvailable: boolean },
    Error,
    { counts: Record<string, number>; namesAvailable: boolean },
    string[]
  >
> =>
  queryOptions({
    // Keyed on the applied set, sorted so `#a #b` and `#b #a` are one cache entry. A full pass
    // costs ~250ms, so the cache is what keeps this off the keystroke path: it only re-runs when
    // the applied TAGS change, never as the fragment being typed narrows.
    queryKey: ["browseCounts", [...applied].sort().join(",")],
    queryFn: async () => {
      const response = await browseCounts(applied);
      return {
        counts: response.counts,
        namesAvailable: response.namesAvailable
      };
    },
    staleTime: Infinity,
    // Keep the PREVIOUS counts while a new applied-set is in flight. Without this the data drops to
    // `undefined` between keys, and the field reads that as "no counts known" — which un-hides the
    // dead combinations for the ~250ms the recount takes, exactly when the user is typing the next
    // tag. Slightly stale counts are strictly better than momentarily absent ones.
    placeholderData: (previous) => previous
  });

export const radicalQuery = (
  selected: string[]
): ReturnType<
  typeof queryOptions<
    RadicalLookupDto,
    Error,
    RadicalLookupDto,
    [string, string]
  >
> =>
  queryOptions({
    // The selection order doesn't affect the result, so sort for a stable cache key.
    queryKey: ["radicals", [...selected].sort().join("")],
    queryFn: async () => (await lookupRadicals(selected)).result
  });

/**
 * Meanings for a set of kanji the webview already has as bare characters.
 *
 * The handwriting recognizer runs entirely in the webview and produces literals with nothing
 * attached, so this is the one kanji list whose rows have to be fetched separately rather than
 * arriving hydrated. Keyed on the literals themselves, IN ORDER — the order is the recognizer's
 * ranking, so unlike `radicalQuery` it must not be sorted into a canonical key.
 *
 * `placeholderData` keeps the previous candidates on screen while the next set loads: a stroke
 * lands, the recognizer re-ranks immediately, and clearing the strip to blank for one round trip
 * reads as a flicker.
 */
export const kanjiPreviewsQuery = (
  literals: string[]
): ReturnType<
  typeof queryOptions<
    KanjiResultDto[],
    Error,
    KanjiResultDto[],
    [string, string]
  >
> =>
  queryOptions({
    queryKey: ["kanjiPreviews", literals.join("")],
    queryFn: async () => (await getKanjiPreviews(literals)).results,
    enabled: literals.length > 0,
    placeholderData: (previous) => previous
  });

/**
 * The diagnostic snapshot, ready to paste. Fetched once per visit: it names versions and a
 * dictionary revision, none of which change while the panel is open.
 */
export const diagnosticsQuery = (): ReturnType<
  typeof queryOptions<string, Error, string, string[]>
> =>
  queryOptions({
    queryKey: ["diagnostics"],
    queryFn: async () => (await getDiagnostics()).markdown,
    staleTime: Infinity
  });

export const aboutQuery = (): ReturnType<
  typeof queryOptions<
    Record<string, string>,
    Error,
    Record<string, string>,
    string[]
  >
> =>
  queryOptions({
    queryKey: ["about"],
    queryFn: async () => (await getAbout()).meta
  });

/**
 * Recent-search history (#17). Cached like anything else, but the cache is also written directly
 * by `recordRecentSearch`/`clearRecentSearches` — every host reply carries the full list, so the
 * UI updates without a refetch round-trip.
 */
export const recentSearchesQuery = (): ReturnType<
  typeof queryOptions<RecentSearchDto[], Error, RecentSearchDto[], string[]>
> =>
  queryOptions({
    queryKey: ["recentSearches"],
    queryFn: async () => (await getRecentSearches()).recent
  });

/**
 * One kanji browse list (#55). Cached indefinitely by default like the other browse queries — the
 * lists only change when the dictionary is replaced.
 */
export const kanjiListQuery = (
  id: string
): ReturnType<
  typeof queryOptions<KanjiResultDto[], Error, KanjiResultDto[], string[]>
> =>
  queryOptions({
    queryKey: ["kanjiList", id],
    queryFn: async () => (await kanjiList(id)).kanji
  });
