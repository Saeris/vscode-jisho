import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb, Breadcrumbs, Button, Link } from "react-aria-components";
import {
  CLASSIFIERS,
  CLASSIFIER_GROUPS,
  type Classifier,
  type ClassifierGroupId
} from "../../shared/classifiers";
import { useNavigate } from "../navigation";
import { browseCountsQuery } from "../queries";
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
  const active = CLASSIFIER_GROUPS.find((g) => g.id === group);
  return (
    <div className={styles.container}>
      <DetailHeader onBack={useNavigate().back} />
      {active === undefined ? (
        <GroupList onOpen={useNavigate().openBrowse} />
      ) : (
        <CategoryList
          group={active.id}
          label={active.label}
          counts={counts?.counts ?? {}}
          namesAvailable={counts?.namesAvailable ?? false}
        />
      )}
    </div>
  );
};

/**
 * The same tree as the Vocab TAB rather than a pushed view (#55).
 *
 * Its drill level is local state, not a stack entry, because the tab is the navigation root: pushing
 * a view would put the browse tree ON TOP of the tab bar it lives inside, and Back would pop out of
 * the root entirely. Local state also means the level survives switching tabs for free — the panel
 * is force-mounted, so nothing here unmounts.
 */
export const BrowseTab = (): React.ReactElement => {
  const { data: counts } = useQuery(browseCountsQuery());
  const [group, setGroup] = useState<ClassifierGroupId | undefined>(undefined);
  const active = CLASSIFIER_GROUPS.find((g) => g.id === group);
  return (
    <div className={styles.container}>
      {active === undefined ? (
        <GroupList onOpen={setGroup} />
      ) : (
        <>
          <BrowseCrumbs
            label={active.label}
            onRoot={() => setGroup(undefined)}
          />
          <CategoryList
            group={active.id}
            label={active.label}
            counts={counts?.counts ?? {}}
            namesAvailable={counts?.namesAvailable ?? false}
          />
        </>
      )}
    </div>
  );
};

/**
 * Where you are in the tree, and the way back up.
 *
 * Breadcrumbs rather than a Back button: inside a tab there is no stack to go back through, so a
 * Back arrow would be lying about what it does. A trail says where "up" goes and stays correct when
 * the tree grows a third level.
 */
const BrowseCrumbs = ({
  label,
  onRoot
}: {
  label: string;
  onRoot: () => void;
}): React.ReactElement => (
  <Breadcrumbs className={styles.crumbs}>
    <Breadcrumb>
      <Link className={styles.crumbLink} onPress={onRoot}>
        Browse
      </Link>
    </Breadcrumb>
    <Breadcrumb>
      <span className={styles.crumbCurrent}>{label}</span>
    </Breadcrumb>
  </Breadcrumbs>
);

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
  label,
  counts,
  namesAvailable
}: {
  group: ClassifierGroupId;
  label: string;
  counts: Record<string, number>;
  /** Hides #name/#place until the names dictionary is provisioned — see TagSearchField. */
  namesAvailable: boolean;
}): React.ReactElement => {
  const { openWordList } = useNavigate();
  return (
    <div className={styles.body}>
      <h1 className={styles.title}>{label}</h1>
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
