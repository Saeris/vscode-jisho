import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Breadcrumb,
  Breadcrumbs,
  Button,
  Link,
  ListBox,
  ListBoxItem
} from "react-aria-components";
import type { Selection } from "react-aria-components";
import {
  KANJI_LIST_BY_ID,
  KANJI_LIST_GROUPS,
  type KanjiListId
} from "../../shared/classifiers";
import { useNavigate } from "../navigation";
import { kanjiListQuery } from "../queries";
import styles from "./Browse.module.css";
import kanjiStyles from "./KanjiBrowse.module.css";

/**
 * The Kanji tab (#55): browse characters by JLPT level, school grade, or frequency.
 *
 * Two levels like the Vocab tab, and local state for the same reason — the tab IS the navigation
 * root, so drilling in must not push a view that would sit on top of the tab bar it lives inside.
 * Tapping a kanji does push, because that leaves the root for a detail page.
 */
export const KanjiBrowse = (): React.ReactElement => {
  const [list, setList] = useState<KanjiListId | undefined>(undefined);
  const active = list === undefined ? undefined : KANJI_LIST_BY_ID.get(list);
  return (
    <div className={styles.container}>
      {active === undefined || list === undefined ? (
        <GroupList onOpen={setList} />
      ) : (
        <>
          <Breadcrumbs className={styles.crumbs}>
            <Breadcrumb>
              <Link
                className={styles.crumbLink}
                onPress={() => setList(undefined)}
              >
                Kanji
              </Link>
            </Breadcrumb>
            <Breadcrumb>
              <span className={styles.crumbCurrent}>{active.label}</span>
            </Breadcrumb>
          </Breadcrumbs>
          <KanjiList id={list} label={active.label} />
        </>
      )}
    </div>
  );
};

/** The top level: the groups, each with its lists. */
const GroupList = ({
  onOpen
}: {
  onOpen: (id: KanjiListId) => void;
}): React.ReactElement => (
  <div className={styles.body}>
    <h1 className={styles.title}>Kanji</h1>
    {KANJI_LIST_GROUPS.map((group) => (
      <section key={group.id}>
        <h2 className={kanjiStyles.groupTitle}>{group.label}</h2>
        {/* The JLPT group carries the two caveats a reader comparing us against another resource
            would otherwise read as our error — see shared/classifiers. */}
        {group.note === undefined ? null : (
          <p className={styles.note}>{group.note}</p>
        )}
        <ul className={styles.list}>
          {group.lists.map((l) => (
            <li key={l.id}>
              <Button
                className={styles.row}
                onPress={() => onOpen(l.id)}
                aria-label={`Browse ${l.label} kanji`}
              >
                <span className={styles.rowLabel}>{l.label}</span>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </div>
);

/**
 * One list's characters, as a grid.
 *
 * A grid rather than the stacked rows the word lists use: a kanji's identity is its SHAPE, so the
 * character wants to be large and scannable, and the meaning/readings are the supporting detail —
 * which is how Shirabe lays the same screen out.
 */
const KanjiList = ({
  id,
  label
}: {
  id: KanjiListId;
  label: string;
}): React.ReactElement => {
  const { openKanji } = useNavigate();
  const { data, isPending } = useQuery(kanjiListQuery(id));
  const kanji = data ?? [];
  // ListBox opens on Enter via onAction; selection stays uncontrolled like the search results.
  const noop = (_: Selection): void => {};

  if (isPending) return <p className={styles.note}>Loading…</p>;
  return (
    <div className={kanjiStyles.body}>
      <p className={kanjiStyles.count}>{kanji.length.toLocaleString()} kanji</p>
      <ListBox
        aria-label={`${label} kanji`}
        className={kanjiStyles.grid}
        layout="grid"
        selectionMode="single"
        onSelectionChange={noop}
        onAction={(key) => openKanji(String(key))}
        items={kanji}
      >
        {(item) => (
          <ListBoxItem
            id={item.literal}
            textValue={item.literal}
            className={kanjiStyles.cell}
          >
            <span className={kanjiStyles.literal} lang="ja">
              {item.literal}
            </span>
            <span className={kanjiStyles.meaning}>{item.meaningPreview}</span>
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
};
