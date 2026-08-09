import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ListBox, ListBoxItem } from "react-aria-components";
import type { Selection } from "react-aria-components";
import type { Classifier } from "../../shared/classifiers";
import {
  browseCountsQuery,
  browseQuery,
  namesQuery,
  searchQuery
} from "../queries";
import { Badge } from "../components/Badge";
import { TagSearchField } from "../components/TagSearchField";
import { JlptBadge } from "../components/JlptBadge";
import { RecentSearches } from "../components/RecentSearches";
import { SegmentBar } from "../components/SegmentBar";
import { openSettings, recordRecentSearch } from "../bridge";
import { useNavigate } from "../navigation";
import { ErrorState } from "../components/ErrorState";
import styles from "./SearchResults.module.css";

interface SearchResultsProps {
  /**
   * Controlled query text — owned by the navigation machine so it survives view changes.
   *
   * Stays a PROP while the actions come from context: this is the value being rendered, and a
   * component that reads its own display state from context is harder to test and to reason about
   * than one handed it. Data down, actions through the hook.
   */
  query: string;
  /**
   * Which breakdown chip is filtering the results, or null for the whole sentence (#16). Owned by
   * the navigation machine for the same reason `query` is: Back from a word must return to the
   * filtered view rather than silently to the unfiltered one.
   */
  selectedSegment: number | null;
}

export const SearchResults = ({
  query,
  selectedSegment
}: SearchResultsProps): React.ReactElement => {
  const {
    setSearchQuery: onQueryChange,
    selectSegment,
    openWord: onOpenWord,
    openKanji: onOpenKanji,
    openName: onOpenName,
    openRadicals,
    openWordList,
    openHandwriting,
    openAbout
  } = useNavigate();
  /**
   * Tag filters currently in the box (#27).
   *
   * Component state rather than the navigation machine's, unlike `query`: a tag is only meaningful
   * while the search view is showing, and the field that owns the tokens unmounts with it. `query`
   * is persisted because Back must restore what you typed; a filter you cannot see has nothing to
   * restore to.
   */
  const [tags, setTags] = useState<Classifier[]>([]);
  // Defer the query feeding TanStack Query so keystrokes stay responsive while results catch up;
  // simpler than a form library for a single field (RHF+Valibot is reserved for real forms).
  const deferredQuery = useDeferredValue(query);
  const client = useQueryClient();
  /**
   * Remember a lookup (#17).
   *
   * Called when the user OPENS a result, not as they type — the query text changes on every
   * keystroke, so recording that would remember `食`, `食べ`, `食べる`, every prefix of every
   * search. Opening a result is the discrete signal of intent, and it makes the list read as
   * "words I looked up" rather than "things I typed".
   *
   * Fire-and-forget: the history is a convenience, and a failure to record one must not interrupt
   * the navigation the user actually asked for.
   */
  const remember = (headword: string | undefined): void => {
    if (headword === undefined) return;
    void (async (): Promise<void> => {
      try {
        const response = await recordRecentSearch(query, headword);
        // The host replies with the full list, so write it into the cache rather than invalidating
        // and paying a second round trip for something we already have.
        client.setQueryData(["recentSearches"], response.recent);
      } catch {
        // Swallowed: the history is a convenience, and failing to record one lookup must not
        // interrupt the navigation the user actually asked for.
      }
    })();
  };
  const {
    data,
    isFetching,
    isError,
    error,
    isPending: isPendingWords
  } = useQuery(searchQuery(deferredQuery));
  // Names come from a separate, opt-in database queried independently — a failure or first-use
  // download of the names DB must not affect word/kanji results, so its errors are ignored here.
  //
  // Gated on the word search having settled, rather than fired alongside it. Both queries share one
  // postMessage channel into a single-threaded host, so racing them means every names message is a
  // turn the word search waits behind — and names are the secondary result. A startup trace showed
  // both provisioning their databases in the same millisecond, with names (a 409MB file) answering
  // first while the words the user actually searched for arrived seconds later. Sequencing costs
  // names a round trip and buys the primary result that time back.
  const { data: names } = useQuery({
    ...namesQuery(deferredQuery),
    enabled: deferredQuery.trim().length > 0 && !isPendingWords
  });
  /**
   * Word results, narrowed by the tag filters.
   *
   * Intersected CLIENT-SIDE against each tag's member list rather than pushed into the search SQL.
   * The search query is a tuned relevance ranking over ~3M term rows; adding a join per tag would
   * mean re-tuning it for a case that only applies when a tag is present. Each tag's list is
   * already fetched and cached for the browse view, so this reuses it.
   *
   * TWO MODES, because a text search and a tag filter are different questions:
   *   - with text: narrow the ranked results to words carrying every tag.
   *   - tags ONLY: the tags ARE the query. The text search never runs on an empty string, so
   *     filtering its (empty) output would show nothing — which is exactly what `#jlpt-n5
   *     #verb-godan` used to do. Intersecting the tag lists directly is the answer to what was
   *     actually asked.
   */
  const tagSets = useQueries({
    queries: tags.map((t) => browseQuery(t.id, "frequency"))
  });

  /**
   * How many results each candidate tag would leave, given the ones already applied — so the
   * autocomplete can show counts and drop combinations that narrow to zero.
   *
   * Keyed on the APPLIED tags, not on what is being typed: a full pass costs ~250ms, and running
   * it per keystroke would make the menu lag behind the text. Cached with `staleTime: Infinity`,
   * so it recomputes only when a tag is added or removed.
   */
  const { data: countsData } = useQuery(
    browseCountsQuery(tags.map((t) => t.id))
  );
  const refineCounts = useMemo(
    () =>
      countsData === undefined
        ? undefined
        : new Map(Object.entries(countsData.counts)),
    [countsData]
  );
  // Whichever tag lists have arrived. Narrowing by a SUBSET is the honest intermediate: with two
  // tags the second lands a beat after the first, and it only ever shows too many results, never
  // the wrong ones. Waiting for all of them blanks the list for that beat, which reads as "no
  // matches" — which is exactly how this looked broken.
  const loaded = tagSets.flatMap((q) => (q.data === undefined ? [] : [q.data]));
  const allWords = data?.words ?? [];

  let words = allWords;
  if (tags.length > 0) {
    const sets = loaded.map((d) => new Set(d.results.map((r) => r.id)));
    if (query.trim() !== "") {
      // With text: narrow the ranked results.
      words = allWords.filter((w) => sets.every((set) => set.has(w.id)));
    } else if (loaded.length > 0) {
      // Tags alone: the first list, narrowed by the rest. Already frequency-ordered, so the most
      // useful words lead.
      words = loaded[0].results.filter((r) =>
        sets.slice(1).every((set) => set.has(r.id))
      );
    } else {
      words = [];
    }
  }
  const kanji = data?.kanji ?? [];
  const nameResults = names ?? [];
  const segments = data?.segments ?? [];

  /**
   * Narrow the results to the selected breakdown chip (#16).
   *
   * Client-side over the results already fetched, like the tag filter above — and here it costs
   * nothing extra, because the host already searched for every content lemma at once: `search`
   * passes all of them as deinflection candidates, so 図書館に行きました returns entries for both
   * 図書館 and 行く in one response. Selecting a chip picks a subset of what is on screen, which is
   * why switching between chips is instant and needs no round trip.
   *
   * Matched against the PRIMARY headword and reading only. Matching any writing pulls in unrelated
   * entries that merely share a form — measured on 私, where the loose rule also returns 妾 and 儂.
   *
   * An out-of-range index (restored from a previous session, before this query's segments existed)
   * simply matches nothing to filter by and leaves the results alone.
   */
  const activeSegment =
    selectedSegment === null ? undefined : segments[selectedSegment];
  if (activeSegment !== undefined) {
    const { lemma } = activeSegment;
    words = words.filter((w) => w.headword === lemma || w.reading === lemma);
  }

  /**
   * Split a sentence's results into the entry for the WHOLE query and the constituent words.
   *
   * Shirabe Jisho's model: search 毎日日本語を勉強します and every result is a fragment of what you
   * typed, so presenting them as a flat list says nothing about what they are. Labelling them
   * "Partial matches" does — and when the sentence IS itself an entry (申し訳ございません), that entry
   * leads, visually distinct, with the fragments below it.
   *
   * Gated on `segments.length > 0`, which is already the app's definition of a multi-word query:
   * `analyzeQuery` emits segments only when a query has more than one content word. A plain lookup
   * (食べる) keeps its single ranked list, where the exact match already leads and a "Partial
   * matches" header would only add noise. It also means this section and the breakdown bar appear
   * together, which is the honest pairing — the bar filters the partial list.
   *
   * The whole-query entry is found by the same primary headword/reading comparison the breakdown
   * filter uses, rather than by a server-side score: the DTO carries no rank, and this is the one
   * question being asked — "is what I typed itself a word?"
   */
  const isSentence = segments.length > 0;
  const trimmedQuery = query.trim();
  const fullMatch = isSentence
    ? words.find(
        (w) => w.headword === trimmedQuery || w.reading === trimmedQuery
      )
    : undefined;
  const partialWords =
    fullMatch === undefined
      ? words
      : words.filter((w) => w.id !== fullMatch.id);

  const count = data ? words.length + kanji.length : undefined;

  // ListBox in single-selection mode opens on Enter via onAction; keep selection uncontrolled.
  const noop = (_: Selection): void => {};

  // Keyboard hand-off between the search input and the results list (BACKLOG #12): ↓ from the
  // input focuses the first result option; ↑ at the top of the list or Esc returns to the input.
  const inputRef = useRef<HTMLDivElement>(null);
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
        {/* Tags and free text come out separately (#27). A lone tag with no text OPENS that
            category's list rather than searching for it — typing `#jlpt-n5` is the shortcut for the
            four taps the browse tree would take, which is the reason to type it at all. */}
        <TagSearchField
          text={query}
          refineCounts={refineCounts}
          // Hides `#name`/`#place` until the names dictionary is provisioned. Defaults to hidden
          // while the answer is in flight, so the tags never flash in and out on load.
          namesAvailable={countsData?.namesAvailable ?? false}
          inputRef={inputRef}
          onKeyDown={onInputKeyDown}
          onOpenTag={openWordList}
          onChange={(text, tags) => {
            setTags(tags);
            onQueryChange(text);
          }}
        />
        <Button
          className={styles.iconButton}
          onPress={() => openRadicals()}
          aria-label="Look up kanji by radicals"
        >
          <span lang="ja">部</span>
        </Button>
        <Button
          className={styles.iconButton}
          onPress={openHandwriting}
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
          onPress={openAbout}
          aria-label="About this extension and its dictionary data"
        >
          ⓘ
        </Button>
      </div>

      {segments.length > 0 ? (
        <SegmentBar
          segments={segments}
          selected={selectedSegment}
          onSelectSegment={selectSegment}
        />
      ) : null}

      {/* Tags count as a query even with no text — they ARE the filter — so the empty view only
          shows when neither is present. */}
      {query.trim() === "" && tags.length === 0 ? (
        // The "Browse by category" link that used to sit here is gone: the Vocab tab (#55) is the
        // same destination, always visible, and offering both made the empty view answer a question
        // the tab bar had already answered.
        <RecentSearches onSelect={onQueryChange} />
      ) : (
        renderStatus({
          query: deferredQuery,
          isFetching,
          isError,
          error,
          count
        })
      )}

      <div className={styles.list} ref={listRef} onKeyDown={onListKeyDown}>
        {/* The whole query, when it is itself a dictionary entry. Its own ListBox rather than the
            first row of the list below, so it can be styled as the answer and the one beneath it
            can be labelled as fragments — and so the keyboard hand-off still finds it first, since
            those handlers look for `[role="option"]` across this whole container. */}
        {fullMatch !== undefined ? (
          <ListBox
            aria-label="Full match"
            selectionMode="single"
            onSelectionChange={noop}
            onAction={(key) => {
              const id = String(key);
              remember(words.find((w) => w.id === id)?.headword);
              onOpenWord(id);
            }}
            items={[fullMatch]}
          >
            {(item) => (
              <ListBoxItem
                id={item.id}
                textValue={item.headword}
                className={`${styles.item} ${styles.fullMatch}`}
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

        {/* Only labelled for a multi-word query, where the results genuinely ARE fragments of what
            was typed. A plain lookup keeps its unlabelled ranked list. */}
        {isSentence && partialWords.length > 0 ? (
          <div className={styles.sectionHeader}>Partial matches</div>
        ) : null}

        {partialWords.length > 0 ? (
          <ListBox
            aria-label={isSentence ? "Partial matches" : "Word results"}
            selectionMode="single"
            onSelectionChange={noop}
            onAction={(key) => {
              const id = String(key);
              remember(words.find((w) => w.id === id)?.headword);
              onOpenWord(id);
            }}
            items={partialWords}
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
              onAction={(key) => {
                // A kanji IS its own headword, so there is nothing to look up here.
                const literal = String(key);
                remember(literal);
                onOpenKanji(literal);
              }}
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
              onAction={(key) => {
                const id = String(key);
                remember(nameResults.find((n) => n.id === id)?.headword);
                onOpenName(id);
              }}
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
  // The empty case is NOT handled here: it renders the recent-search history, which needs hooks,
  // and this is a plain function. `SearchResults` renders <RecentSearches /> instead.
  if (query.trim() === "") return null;
  if (isError) {
    return (
      <ErrorState error={error} context="searching" fallback="Search failed." />
    );
  }
  if (isFetching && count === undefined) {
    return <p className={styles.status}>Searching…</p>;
  }
  if (count === 0) {
    return <p className={styles.status}>No results for “{query}”.</p>;
  }
  return null;
};
