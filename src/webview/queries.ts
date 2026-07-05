/**
 * TanStack Query options for the dictionary. Each wraps a bridge call so loading/error/caching are
 * declarative and the components never touch `postMessage` directly.
 */
import { queryOptions } from "@tanstack/react-query";
import type { SearchResultDto, WordDetailDto } from "../shared/messages";
import { getWord, searchWords } from "./bridge";

export const searchQuery = (
  query: string
): ReturnType<
  typeof queryOptions<SearchResultDto[], Error, SearchResultDto[], string[]>
> =>
  queryOptions({
    queryKey: ["search", query],
    queryFn: async () => (await searchWords(query)).results,
    // An empty query has no results; don't round-trip to the host.
    enabled: query.trim().length > 0
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
