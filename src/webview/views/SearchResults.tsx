import { useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Input,
  ListBox,
  ListBoxItem,
  SearchField
} from "react-aria-components";
import type { Selection } from "react-aria-components";
import { searchQuery } from "../queries";
import { Badge } from "../components/Badge";
import styles from "./SearchResults.module.css";

interface SearchResultsProps {
  /** Controlled query text — owned by the navigation machine so it survives view changes. */
  query: string;
  onQueryChange: (query: string) => void;
  onOpenWord: (id: string) => void;
}

export const SearchResults = ({
  query,
  onQueryChange,
  onOpenWord
}: SearchResultsProps): React.ReactElement => {
  // Defer the query feeding TanStack Query so keystrokes stay responsive while results catch up;
  // simpler than a form library for a single field (RHF+Valibot is reserved for real forms).
  const deferredQuery = useDeferredValue(query);
  const { data, isFetching, isError, error } = useQuery(
    searchQuery(deferredQuery)
  );

  const handleAction = (key: React.Key): void => {
    onOpenWord(String(key));
  };
  // ListBox in single-selection mode also opens on Enter via onAction; keep selection uncontrolled.
  const noop = (_: Selection): void => {};

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <SearchField
          aria-label="Search the dictionary"
          value={query}
          onChange={onQueryChange}
          autoFocus
        >
          <Input
            className={styles.input}
            placeholder="Search 日本語 or English…"
          />
        </SearchField>
      </div>

      {renderStatus({
        query: deferredQuery,
        isFetching,
        isError,
        error,
        count: data?.length
      })}

      <ListBox
        className={styles.list}
        aria-label="Search results"
        selectionMode="single"
        onSelectionChange={noop}
        onAction={handleAction}
        items={data ?? []}
      >
        {(item) => (
          <ListBoxItem
            id={item.id}
            textValue={item.headword}
            className={styles.item}
          >
            <span className={styles.itemTop}>
              <span className={styles.headword}>{item.headword}</span>
              {item.reading ? (
                <span className={styles.reading}>{item.reading}</span>
              ) : null}
              {item.common ? <Badge kind="common">common</Badge> : null}
            </span>
            <span className={styles.gloss}>{item.glossPreview}</span>
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
};

const renderStatus = ({
  query,
  isFetching,
  isError,
  error,
  count
}: {
  query: string;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  count: number | undefined;
}): React.ReactElement | null => {
  if (query.trim() === "") {
    return <p className={styles.status}>Type to search the dictionary.</p>;
  }
  if (isError) {
    const message = error instanceof Error ? error.message : "Search failed.";
    return <p className={styles.status}>{message}</p>;
  }
  if (isFetching && count === undefined) {
    return <p className={styles.status}>Searching…</p>;
  }
  if (count === 0) {
    return <p className={styles.status}>No results for “{query}”.</p>;
  }
  return null;
};
