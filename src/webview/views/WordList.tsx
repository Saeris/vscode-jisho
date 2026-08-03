import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ListBox, ListBoxItem } from "react-aria-components";
import type { SearchResultDto } from "../../shared/messages";
import { CLASSIFIER_BY_ID } from "../../shared/classifiers";
import { gojuonRow, GOJUON_ROWS } from "../../shared/kana";
import { useNavigate } from "../navigation";
import { browseQuery } from "../queries";
import { Badge } from "../components/Badge";
import { JlptBadge } from "../components/JlptBadge";
import { DetailHeader } from "../components/DetailHeader";
import styles from "./WordList.module.css";

/**
 * One classifier's words (#54) — the list a browse tap or a `#tag` opens.
 *
 * Ordered by frequency by default, because the first thing a learner wants from "N5 vocabulary" is
 * the words they will actually meet first. Gojūon is the alternative for when the list is being
 * used as an INDEX rather than a study order — that is the mode the kana rail serves, so switching
 * to it is what reveals the rail.
 */
export const WordList = ({ id }: { id: string }): React.ReactElement => {
  const [order, setOrder] = useState<"frequency" | "gojuon">("frequency");
  const { back, openWord } = useNavigate();
  const classifier = CLASSIFIER_BY_ID.get(id);
  const { data, isPending } = useQuery(browseQuery(id, order));
  const listRef = useRef<HTMLDivElement>(null);

  const results = data?.results ?? [];
  // Where each kana row starts, for the jump rail. Computed from the SORTED list, so it is only
  // meaningful in gojūon order — in frequency order the readings are in no particular sequence and
  // a rail would scroll to arbitrary places.
  const anchors = useMemo(() => {
    if (order !== "gojuon") return new Map<string, number>();
    const out = new Map<string, number>();
    results.forEach((r, i) => {
      const row = gojuonRow(r.reading === "" ? r.headword : r.reading);
      if (row !== undefined && !out.has(row)) out.set(row, i);
    });
    return out;
  }, [results, order]);

  return (
    <div className={styles.container}>
      <DetailHeader onBack={back} />
      <div className={styles.head}>
        <h1 className={styles.title}>{classifier?.label ?? id}</h1>
        <span className={styles.total}>
          {data === undefined ? "" : `${data.total.toLocaleString()} words`}
        </span>
      </div>

      <div className={styles.orderRow} role="group" aria-label="Sort order">
        <Button
          className={styles.orderButton}
          data-selected={order === "frequency" || undefined}
          onPress={() => setOrder("frequency")}
        >
          By frequency
        </Button>
        <Button
          className={styles.orderButton}
          data-selected={order === "gojuon" || undefined}
          onPress={() => setOrder("gojuon")}
        >
          あ–ん
        </Button>
      </div>

      <div className={styles.listWrap}>
        {/* The kana jump rail, only in gojūon order — see `anchors`. Rows with no words are shown
            but inert, so the rail keeps a stable shape rather than reflowing per category. Placed
            BEFORE the list so it sits on the leading edge, where a thumb index belongs. */}
        {order === "gojuon" && results.length > 0 ? (
          <nav className={styles.rail} aria-label="Jump to kana row">
            {GOJUON_ROWS.map((row) => (
              <button
                key={row}
                type="button"
                className={styles.railKey}
                disabled={!anchors.has(row)}
                onClick={() => {
                  const index = anchors.get(row);
                  if (index === undefined) return;
                  // Scroll the row's first item into view. Querying the rendered item by index is
                  // what keeps this correct regardless of row height, which varies with the gloss.
                  listRef.current
                    ?.querySelectorAll("[role='option']")
                    [index]?.scrollIntoView({ block: "start" });
                }}
              >
                {row}
              </button>
            ))}
          </nav>
        ) : null}

        <div className={styles.list} ref={listRef}>
          {isPending ? (
            <p className={styles.empty}>Loading…</p>
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
              items={results}
            >
              {(item: SearchResultDto) => (
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
          )}
        </div>
      </div>
    </div>
  );
};
