import { useDeferredValue, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Input,
  ListBox,
  ListBoxItem,
  SearchField
} from "react-aria-components";
import type { Selection } from "react-aria-components";
import { namesQuery, searchQuery } from "../queries";
import { Badge } from "../components/Badge";
import { JlptBadge } from "../components/JlptBadge";
import { SegmentBar } from "../components/SegmentBar";
import { openSettings } from "../bridge";
import styles from "./SearchResults.module.css";

interface SearchResultsProps {
  /** Controlled query text — owned by the navigation machine so it survives view changes. */
  query: string;
  onQueryChange: (query: string) => void;
  onOpenWord: (id: string) => void;
  onOpenKanji: (literal: string) => void;
  onOpenName: (id: string) => void;
  onOpenRadicals: () => void;
  onOpenHandwriting: () => void;
  onOpenAbout: () => void;
}

export const SearchResults = ({
  query,
  onQueryChange,
  onOpenWord,
  onOpenKanji,
  onOpenName,
  onOpenRadicals,
  onOpenHandwriting,
  onOpenAbout
}: SearchResultsProps): React.ReactElement => {
  // Defer the query feeding TanStack Query so keystrokes stay responsive while results catch up;
  // simpler than a form library for a single field (RHF+Valibot is reserved for real forms).
  const deferredQuery = useDeferredValue(query);
  const { data, isFetching, isError, error } = useQuery(
    searchQuery(deferredQuery)
  );
  // Names come from a separate, opt-in database queried independently — a failure or first-use
  // download of the names DB must not affect word/kanji results, so its errors are ignored here.
  const { data: names } = useQuery(namesQuery(deferredQuery));
  const words = data?.words ?? [];
  const kanji = data?.kanji ?? [];
  const nameResults = names ?? [];
  const segments = data?.segments ?? [];
  const count = data ? words.length + kanji.length : undefined;

  // ListBox in single-selection mode opens on Enter via onAction; keep selection uncontrolled.
  const noop = (_: Selection): void => {};

  // Keyboard hand-off between the search input and the results list (BACKLOG #12): ↓ from the
  // input focuses the first result option; ↑ at the top of the list or Esc returns to the input.
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const focusFirstResult = (): void => {
    const first =
      listRef.current?.querySelector<HTMLElement>('[role="option"]');
    first?.focus();
  };

  const onInputKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown" && (words.length > 0 || kanji.length > 0)) {
      e.preventDefault();
      focusFirstResult();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      // Only intercept when at the very first option; otherwise let React Aria move up the list.
      const options = listRef.current?.querySelectorAll('[role="option"]');
      if (options && options[0] === document.activeElement) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
  };

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
            ref={inputRef}
            className={styles.input}
            placeholder="Search 日本語 or English…"
            onKeyDown={onInputKeyDown}
          />
        </SearchField>
        <Button
          className={styles.iconButton}
          onPress={onOpenRadicals}
          aria-label="Look up kanji by radicals"
        >
          <span lang="ja">部</span>
        </Button>
        <Button
          className={styles.iconButton}
          onPress={onOpenHandwriting}
          aria-label="Draw a kanji to search"
        >
          ✏️
        </Button>
        <Button
          className={styles.iconButton}
          onPress={() => void openSettings()}
          aria-label="Open Jisho settings"
        >
          ⚙
        </Button>
        <Button
          className={styles.iconButton}
          onPress={onOpenAbout}
          aria-label="About this extension and its dictionary data"
        >
          ⓘ
        </Button>
      </div>

      {segments.length > 0 ? (
        <SegmentBar segments={segments} onSelectSegment={onQueryChange} />
      ) : null}

      {renderStatus({
        query: deferredQuery,
        isFetching,
        isError,
        error,
        count
      })}

      <div className={styles.list} ref={listRef} onKeyDown={onListKeyDown}>
        {words.length > 0 ? (
          <ListBox
            aria-label="Word results"
            selectionMode="single"
            onSelectionChange={noop}
            onAction={(key) => onOpenWord(String(key))}
            items={words}
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
                  <JlptBadge level={item.jlpt} />
                </span>
                <span className={styles.gloss}>{item.glossPreview}</span>
              </ListBoxItem>
            )}
          </ListBox>
        ) : null}

        {kanji.length > 0 ? (
          <>
            <div className={styles.sectionHeader}>Kanji</div>
            <ListBox
              aria-label="Kanji results"
              selectionMode="single"
              onSelectionChange={noop}
              onAction={(key) => onOpenKanji(String(key))}
              items={kanji}
            >
              {(item) => (
                <ListBoxItem
                  id={item.literal}
                  textValue={item.literal}
                  className={styles.kanjiItem}
                >
                  <span className={styles.kanjiLiteral} lang="ja">
                    {item.literal}
                  </span>
                  <span className={styles.kanjiInfo}>
                    <span className={styles.kanjiMeaning}>
                      {item.meaningPreview}
                    </span>
                    <span className={styles.kanjiReadings} lang="ja">
                      {[item.onPreview, item.kunPreview]
                        .filter(Boolean)
                        .join("　")}
                    </span>
                  </span>
                </ListBoxItem>
              )}
            </ListBox>
          </>
        ) : null}

        {nameResults.length > 0 ? (
          <>
            <div className={styles.sectionHeader}>Names</div>
            <ListBox
              aria-label="Name results"
              selectionMode="single"
              onSelectionChange={noop}
              onAction={(key) => onOpenName(String(key))}
              items={nameResults}
            >
              {(item) => (
                <ListBoxItem
                  id={item.id}
                  textValue={item.headword}
                  className={styles.item}
                >
                  <span className={styles.itemTop}>
                    <span className={styles.headword} lang="ja">
                      {item.headword}
                    </span>
                    {item.reading ? (
                      <span className={styles.reading} lang="ja">
                        {item.reading}
                      </span>
                    ) : null}
                    {item.types.length > 0 ? (
                      <span className={styles.nameType}>
                        {item.types.join(", ")}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.gloss}>
                    {item.translationPreview}
                  </span>
                </ListBoxItem>
              )}
            </ListBox>
          </>
        ) : null}
      </div>
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
