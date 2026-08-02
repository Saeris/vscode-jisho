import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ListBox, ListBoxItem } from "react-aria-components";
import { clearRecentSearches } from "../bridge";
import { recentSearchesQuery } from "../queries";
import styles from "./RecentSearches.module.css";

/**
 * The empty search view's history (#17) — the panel's only affordance when the box is empty, which
 * was previously one line of instruction.
 *
 * Renders what the user OPENED rather than what they typed: the label is the headword, with the
 * query shown only when it differs (searching `taberu` and opening 食べる shows both). Tapping
 * re-runs the query rather than jumping straight to the entry, so the user lands where they can
 * see alternatives — the same place they were when they chose it the first time.
 */
export const RecentSearches = ({
  onSelect
}: {
  /** Re-run a remembered query. */
  onSelect: (query: string) => void;
}): React.ReactElement => {
  const client = useQueryClient();
  const { data: recent = [] } = useQuery(recentSearchesQuery());
  const clear = useMutation({
    mutationFn: clearRecentSearches,
    // The host replies with the (now empty) list, so write it straight into the cache instead of
    // invalidating and paying another round trip for a result we already have.
    onSuccess: (response) =>
      client.setQueryData(["recentSearches"], response.recent)
  });

  if (recent.length === 0) {
    return <p className={styles.hint}>Type to search the dictionary.</p>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Recent</span>
        <Button
          className={styles.clear}
          onPress={() => clear.mutate()}
          isDisabled={clear.isPending}
        >
          Clear
        </Button>
      </div>
      <ListBox
        aria-label="Recent searches"
        selectionMode="single"
        // `onAction` rather than selection: this is a list of commands, not a set of choices, so a
        // tap should act rather than leave a row selected behind.
        onAction={(key) => onSelect(String(key))}
        items={recent.map((r) => ({ ...r, id: r.query }))}
        className={styles.list}
      >
        {(item) => (
          <ListBoxItem
            id={item.id}
            textValue={item.headword}
            className={styles.item}
          >
            <span className={styles.headword} lang="ja">
              {item.headword}
            </span>
            {item.query !== item.headword ? (
              <span className={styles.query}>{item.query}</span>
            ) : null}
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
};
