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
  browseCounts,
  getAbout,
  getKanji,
  getMoreExamples,
  getName,
  getComponentTree,
  getRecentSearches,
  getStrokeSvg,
  getWord,
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
  typeof queryOptions<
    { results: SearchResultDto[]; total: number },
    Error,
    { results: SearchResultDto[]; total: number },
    string[]
  >
> =>
  queryOptions({
    queryKey: ["browse", id, order],
    queryFn: async () => {
      const response = await browse(id, order);
      return { results: response.results, total: response.total };
    }
  });

/**
 * Word counts for the whole classifier tree.
 *
 * `staleTime: Infinity` — these change only when the dictionary itself is replaced, so refetching
 * them on every visit to the tree would be ~90 COUNT queries for an answer that cannot have moved.
 */
export const browseCountsQuery = (): ReturnType<
  typeof queryOptions<
    Record<string, number>,
    Error,
    Record<string, number>,
    string[]
  >
> =>
  queryOptions({
    queryKey: ["browseCounts"],
    queryFn: async () => (await browseCounts()).counts,
    staleTime: Infinity
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
