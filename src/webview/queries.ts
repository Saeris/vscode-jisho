/**
 * TanStack Query options for the dictionary. Each wraps a bridge call so loading/error/caching are
 * declarative and the components never touch `postMessage` directly.
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  KanjiDetailDto,
  KanjiResultDto,
  SearchResultDto,
  WordDetailDto
} from "../shared/messages";
import { getAbout, getKanji, getWord, searchWords } from "./bridge";

/** Search results grouped into the two sections the UI renders. */
export interface SearchResults {
  words: SearchResultDto[];
  kanji: KanjiResultDto[];
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
      return { words: response.results, kanji: response.kanji };
    },
    // An empty query has no results; don't round-trip to the host.
    enabled: query.trim().length > 0
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
