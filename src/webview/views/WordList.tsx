import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Header
} from "react-aria-components";
import type { KanjiResultDto, SearchResultDto } from "../../shared/messages";
import { CLASSIFIER_BY_ID } from "../../shared/classifiers";
import {
  gojuonHead,
  gojuonRow,
  GOJUON_HEADS,
  GOJUON_ROWS
} from "../../shared/kana";
import { useNavigate } from "../navigation";
import { browseQuery } from "../queries";
import { Badge } from "../components/Badge";
import { JlptBadge } from "../components/JlptBadge";
import { DetailHeader } from "../components/DetailHeader";
import styles from "./WordList.module.css";

/**
 * One classifier's words (#54) — the list a browse tap or a `#tag` opens.
 *
 * Ordered by GOJŪON by default. This list is an index: a reader arriving at "N5 vocabulary" is
 * usually looking for a particular word, and kana order plus the jump rail is how a Japanese
 * dictionary is navigated. Frequency is the alternative, for reading the list as a study order
 * rather than searching it.
 */
export const WordList = ({ id }: { id: string }): React.ReactElement => {
  const [order, setOrder] = useState<"gojuon" | "frequency">("gojuon");
  const { back, openWord, openKanji } = useNavigate();
  const classifier = CLASSIFIER_BY_ID.get(id);
  const { data, isPending } = useQuery(browseQuery(id, order));
  const listRef = useRef<HTMLDivElement>(null);

  const results = data?.results ?? [];
  /**
   * Kanji rows, for `#kanji`. Only one of the two arrays is ever populated, so branching on which
   * one has content is simpler than branching on the classifier's kind — and it keeps the empty
   * state, the header and the ordering controls shared between both.
   */
  const kanji = data?.kanji ?? [];
  const isKanjiList = kanji.length > 0;

  /**
   * The list grouped under kana headings, in syllabary order.
   *
   * Only meaningful in gojūon order — in frequency order the readings are in no particular
   * sequence, so headings would carve the list at arbitrary points and the rail would scroll
   * somewhere unrelated to its label.
   */
  const sections = useMemo(() => {
    if (order !== "gojuon") return [];
    const byRow = new Map<string, SearchResultDto[]>();
    for (const r of results) {
      const row = gojuonRow(r.reading === "" ? r.headword : r.reading);
      if (row === undefined) continue;
      byRow.set(row, [...(byRow.get(row) ?? []), r]);
    }
    // Driven by GOJUON_ROWS rather than by insertion order, so the sections come out in syllabary
    // order regardless of how the rows happened to arrive.
    return GOJUON_ROWS.flatMap((row) => {
      const items = byRow.get(row);
      return items === undefined ? [] : [{ row, items }];
    });
  }, [results, order]);

  const present = useMemo(
    () => new Set(sections.map((s) => s.row)),
    [sections]
  );

  /**
   * Scroll a kana section to the TOP of the list viewport, the way a thumb index behaves.
   *
   * Falls forward to the next section that EXISTS when the tapped one does not. That is what keeps
   * the compact rail (row-heads only, on a short panel) honest: tapping や lands on ゆ when や
   * itself has no words, rather than doing nothing.
   */
  const jumpTo = (row: string): void => {
    const list = listRef.current;
    const from = GOJUON_ROWS.indexOf(row);
    const target =
      sections.find((s) => GOJUON_ROWS.indexOf(s.row) >= from)?.row ?? row;
    const heading = list?.querySelector<HTMLElement>(`[data-row="${target}"]`);
    if (!list || !heading) return;
    // `scrollTop` arithmetic rather than `scrollIntoView`: the latter aligns to the nearest edge
    // or scrolls ancestors, and what is wanted here is specifically "this heading, at the top of
    // the list area".
    list.scrollTop +=
      heading.getBoundingClientRect().top - list.getBoundingClientRect().top;
  };

  return (
    <div className={styles.container}>
      <DetailHeader onBack={back} />
      <div className={styles.head}>
        <h1 className={styles.title}>{classifier?.label ?? id}</h1>
        <span className={styles.total}>
          {data === undefined
            ? ""
            : `${data.total.toLocaleString()} ${isKanjiList ? "kanji" : "words"}`}
        </span>
      </div>

      {/* Ordering controls are for WORD lists only. A kanji has no reading to sort gojūon by, so
          offering あ–ん there would be a control that cannot do anything — the list is ordered by
          newspaper frequency then stroke count, which is what a character list wants. */}
      {isKanjiList ? null : (
        <div className={styles.orderRow} role="group" aria-label="Sort order">
          <Button
            className={styles.orderButton}
            data-selected={order === "gojuon" || undefined}
            onPress={() => setOrder("gojuon")}
          >
            あ–ん
          </Button>
          <Button
            className={styles.orderButton}
            data-selected={order === "frequency" || undefined}
            onPress={() => setOrder("frequency")}
          >
            By frequency
          </Button>
        </div>
      )}

      <div className={styles.listWrap}>
        {/* The kana rail, only in gojūon order. Every heading is shown even when empty, so the
            rail's shape is the same in every category — a control that reflows per list is harder
            to aim at than one that does not. */}
        {order === "gojuon" && results.length > 0 ? (
          <nav className={styles.rail} aria-label="Jump to kana">
            {GOJUON_ROWS.map((row) => {
              const isHead = GOJUON_HEADS.includes(row);
              // A row-head stays enabled whenever ANY section in its row has words, because the
              // compact rail falls forward — tapping や with only ゆ present must still work.
              const reachable = isHead
                ? sections.some((s) => gojuonHead(s.row) === row)
                : present.has(row);
              return (
                <button
                  key={row}
                  type="button"
                  className={styles.railKey}
                  // Marks the ten row-heads: the compact rail (short panel) hides everything else.
                  data-head={isHead ? "" : undefined}
                  disabled={!reachable}
                  onClick={() => jumpTo(row)}
                >
                  {row}
                </button>
              );
            })}
          </nav>
        ) : null}

        <div className={styles.list} ref={listRef}>
          {isPending ? (
            <p className={styles.empty}>Loading…</p>
          ) : isKanjiList ? (
            <ListBox
              aria-label={`${classifier?.label ?? id} kanji`}
              selectionMode="single"
              onAction={(key) => {
                openKanji(String(key));
              }}
            >
              {kanji.map((item) => (
                <KanjiRow key={item.literal} item={item} />
              ))}
            </ListBox>
          ) : results.length === 0 ? (
            // An empty category is a truthful answer about the shipped dictionary, not an error —
            // most dialects have no COMMON words, and this build ships the common subset.
            <p className={styles.empty}>
              No words in this category in the installed dictionary.
            </p>
          ) : (
            <ListBox
              aria-label={`${classifier?.label ?? id} words`}
              selectionMode="single"
              onAction={(key) => {
                openWord(String(key));
              }}
            >
              {order === "gojuon"
                ? sections.map((section) => (
                    <ListBoxSection
                      key={section.row}
                      id={section.row}
                      className={styles.section}
                    >
                      <Header
                        className={styles.sectionHeader}
                        data-row={section.row}
                      >
                        {section.row}
                      </Header>
                      {section.items.map((item) => (
                        <WordRow key={item.id} item={item} />
                      ))}
                    </ListBoxSection>
                  ))
                : results.map((item) => <WordRow key={item.id} item={item} />)}
            </ListBox>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * One kanji in a browsed character list.
 *
 * Mirrors the search view's kanji row — same literal-then-meaning-then-readings shape — because a
 * browsed kanji and a searched one are the same thing arrived at two ways, and a reader should not
 * have to re-learn the layout.
 */
const KanjiRow = ({ item }: { item: KanjiResultDto }): React.ReactElement => (
  <ListBoxItem
    id={item.literal}
    textValue={item.literal}
    className={styles.kanjiItem}
  >
    <span className={styles.kanjiLiteral} lang="ja">
      {item.literal}
    </span>
    <span className={styles.kanjiInfo}>
      <span className={styles.kanjiMeaning}>{item.meaningPreview}</span>
      <span className={styles.kanjiReadings} lang="ja">
        {[item.onPreview, item.kunPreview].filter(Boolean).join("　")}
      </span>
    </span>
  </ListBoxItem>
);

const WordRow = ({ item }: { item: SearchResultDto }): React.ReactElement => (
  <ListBoxItem id={item.id} textValue={item.headword} className={styles.item}>
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
);
