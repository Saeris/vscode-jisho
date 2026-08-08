import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import {
  CLASSIFIERS,
  CLASSIFIER_GROUPS,
  type Classifier,
  type ClassifierGroupId
} from "../../shared/classifiers";
import { useNavigate } from "../navigation";
import { browseCountsQuery } from "../queries";
import { BrowseHeader } from "../components/BrowseHeader";
import { DetailHeader } from "../components/DetailHeader";
import styles from "./Browse.module.css";

/**
 * The classifier tree (#54) — a second way in, for the reader who does not yet know what to search
 * for. Two levels: the groups, then the categories inside one.
 *
 * Two levels rather than a nested tree because the depth is real but shallow — every category is
 * one tap from its group — and a collapsing tree inside a sidebar this narrow spends most of its
 * width on indentation. Drilling in also gives each level its own Back, which the navigation stack
 * already handles.
 *
 * Counts come from ONE request for the whole tree (`browseCounts`), not one per row: ~90 categories
 * at a round trip each would be visibly slow, and the numbers only change when the dictionary is
 * replaced.
 */
export const Browse = ({ group }: { group?: string }): React.ReactElement => {
  const { data: counts } = useQuery(browseCountsQuery());
  const { openBrowse, home, back } = useNavigate();
  const active = CLASSIFIER_GROUPS.find((g) => g.id === group);
  return (
    <div className={styles.container}>
      {active === undefined ? (
        <>
          <DetailHeader onBack={back} />
          <GroupList onOpen={openBrowse} />
        </>
      ) : (
        <>
          {/* Pushed rather than the tab, so the root crumb is HOME, not "Vocab": this view is
              reached by graph traversal (a grammar tag on a word page), and naming a tab would
              claim a parent the reader did not come through. See BrowseHeader. */}
          <BrowseHeader
            crumbs={[
              {
                label: "⌂",
                onPress: home ?? back,
                ariaLabel: "Back to search"
              },
              { label: "Browse", onPress: () => openBrowse() },
              { label: active.label }
            ]}
          />
          <CategoryList
            group={active.id}
            counts={counts?.counts ?? {}}
            namesAvailable={counts?.namesAvailable ?? false}
          />
        </>
      )}
    </div>
  );
};

/**
 * The same tree as the Vocab TAB rather than a pushed view (#55).
 *
 * Drilling in does not push: the tab IS the navigation root, so a pushed view would sit on top of
 * the tab bar it lives inside and Back would pop out of the root entirely. The level is therefore a
 * field on the machine's context rather than a stack entry.
 *
 * It used to be local `useState` here, which was simpler and wrong in one specific way: a pushed
 * word list's breadcrumb needs to send the reader to the TOP of this tab, and a sibling view cannot
 * reach a `useState` setter. The root crumb could only pop the stack, landing back on this tab
 * still drilled into its group — the reported bug. See `NavContext.browseGroup`.
 */
export const BrowseTab = (): React.ReactElement => {
  const { data: counts } = useQuery(browseCountsQuery());
  const { browseGroup, selectBrowseGroup } = useNavigate();
  const active = CLASSIFIER_GROUPS.find((g) => g.id === browseGroup);
  return (
    <div className={styles.container}>
      {active === undefined ? (
        <GroupList onOpen={selectBrowseGroup} />
      ) : (
        <>
          {/* The trail REPLACES the level's <h1>, so the current crumb is the heading — see
              BrowseHeader. Two levels today; a third would be one more entry. */}
          <BrowseHeader
            crumbs={[
              { label: "Vocab", onPress: () => selectBrowseGroup(undefined) },
              { label: active.label }
            ]}
          />
          <CategoryList
            group={active.id}
            counts={counts?.counts ?? {}}
            namesAvailable={counts?.namesAvailable ?? false}
          />
        </>
      )}
    </div>
  );
};

/** The top level: one row per group. */
const GroupList = ({
  onOpen
}: {
  onOpen: (group: ClassifierGroupId) => void;
}): React.ReactElement => (
  <div className={styles.body}>
    <h1 className={styles.title}>Browse</h1>
    <ul className={styles.list}>
      {CLASSIFIER_GROUPS.map((g) => (
        <li key={g.id}>
          <Button
            className={styles.row}
            onPress={() => onOpen(g.id)}
            aria-label={`Browse ${g.label}`}
          >
            <span className={styles.rowLabel}>{g.label}</span>
            <span className={styles.rowCount}>{CLASSIFIERS[g.id].length}</span>
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </Button>
        </li>
      ))}
    </ul>
  </div>
);

/** One group's categories, each opening its word list. */
const CategoryList = ({
  group,
  counts,
  namesAvailable
}: {
  group: ClassifierGroupId;
  counts: Record<string, number>;
  /** Hides #name/#place until the names dictionary is provisioned — see TagSearchField. */
  namesAvailable: boolean;
}): React.ReactElement => {
  const { openWordList } = useNavigate();
  return (
    <div className={styles.body}>
      {/* No <h1>: the breadcrumb's current crumb is this level's heading. */}
      {group === "jlpt" ? (
        <p className={styles.note}>
          Levels are an unofficial estimate — official vocabulary lists have not
          been published since 2010.
        </p>
      ) : null}
      <ul className={styles.list}>
        {CLASSIFIERS[group]
          // Names and places need a dictionary that may not be downloaded — the same rule the tag
          // autocomplete applies, so the two surfaces offer the same vocabulary.
          .filter(
            (c) =>
              namesAvailable ||
              c.kind !== "result" ||
              (c.result !== "name" && c.result !== "place")
          )
          .map((c) => (
            <CategoryRow
              key={c.id}
              classifier={c}
              count={counts[c.id]}
              onOpen={() => openWordList(c.id)}
            />
          ))}
      </ul>
    </div>
  );
};

const CategoryRow = ({
  classifier,
  count,
  onOpen
}: {
  classifier: Classifier;
  count: number | undefined;
  onOpen: () => void;
}): React.ReactElement => (
  <li>
    <Button
      className={styles.row}
      onPress={onOpen}
      // A category with no words in this build stays visible but is not worth opening. Disabling
      // rather than hiding it is the honest signal: the category exists, the shipped dictionary
      // just has nothing in it (every dialect but Kansai-ben, in a `common` build).
      isDisabled={count === 0}
      aria-label={`${classifier.label}, ${String(count ?? 0)} words`}
    >
      <span className={styles.rowLabel}>{classifier.label}</span>
      <span className={styles.rowCount}>
        {count === undefined ? "" : count.toLocaleString()}
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Button>
  </li>
);
