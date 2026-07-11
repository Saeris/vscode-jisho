/**
 * TanStack Query options for the dictionary. Each wraps a bridge call so loading/error/caching are
 * declarative and the components never touch `postMessage` directly.
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  KanjiDetailDto,
  KanjiResultDto,
  NameDetailDto,
  NameResultDto,
  RadicalLookupDto,
  SearchResultDto,
  SegmentDto,
  WordDetailDto
} from "../shared/messages";
import {
  getAbout,
  getKanji,
  getName,
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
