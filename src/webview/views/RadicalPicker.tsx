import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import type { RadicalDto } from "../../shared/messages";
import { radicalQuery } from "../queries";
import { DetailHeader } from "../components/DetailHeader";
import styles from "./RadicalPicker.module.css";

interface RadicalPickerProps {
  onBack: () => void;
  onOpenKanji: (literal: string) => void;
}

/**
 * Shirabe's "Radicals" lookup: pick component radicals (grouped by stroke count) to narrow the
 * candidate kanji. Selection is local state — it doesn't need to survive navigation. The host
 * returns which radicals stay reachable so we can grey out dead ends.
 */
export const RadicalPicker = ({
  onBack,
  onOpenKanji
}: RadicalPickerProps): React.ReactElement => {
  const [selected, setSelected] = useState<string[]>([]);
  const { data } = useQuery(radicalQuery(selected));

  const toggle = (radical: string): void => {
    setSelected((prev) =>
      prev.includes(radical)
        ? prev.filter((r) => r !== radical)
        : [...prev, radical]
    );
  };

  // Group radicals by stroke count for the grid.
  const groups = useMemo(() => {
    const byStroke = new Map<number, RadicalDto[]>();
    for (const r of data?.radicals ?? []) {
      const list = byStroke.get(r.strokeCount) ?? [];
      list.push(r);
      byStroke.set(r.strokeCount, list);
    }
    return [...byStroke.entries()].sort((a, b) => a[0] - b[0]);
  }, [data?.radicals]);

  const enabled = useMemo(() => new Set(data?.enabled ?? []), [data?.enabled]);
  const hasSelection = selected.length > 0;

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack}>
        {hasSelection ? (
          <Button className={styles.clear} onPress={() => setSelected([])}>
            Clear
          </Button>
        ) : null}
      </DetailHeader>

      <div className={styles.picker} lang="ja">
        {groups.map(([strokeCount, radicals]) => (
          <div key={strokeCount} className={styles.group}>
            <span className={styles.strokeLabel}>{strokeCount}</span>
            {radicals.map((r) => {
              const isSelected = selected.includes(r.radical);
              // With a selection active, a radical that can't extend it is disabled.
              const isDisabled =
                hasSelection && !isSelected && !enabled.has(r.radical);
              return (
                <Button
                  key={r.radical}
                  className={styles.radical}
                  data-selected={isSelected || undefined}
                  isDisabled={isDisabled}
                  onPress={() => toggle(r.radical)}
                >
                  {r.radical}
                </Button>
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.matches} lang="ja">
        {!hasSelection ? (
          <p className={styles.hint}>Select radicals to find kanji.</p>
        ) : data && data.matches.length === 0 ? (
          <p className={styles.hint}>No kanji match this combination.</p>
        ) : (
          (data?.matches ?? []).map((k) => (
            <Button
              key={k.literal}
              className={styles.match}
              onPress={() => onOpenKanji(k.literal)}
              aria-label={`Open ${k.literal}: ${k.meaningPreview}`}
            >
              {k.literal}
            </Button>
          ))
        )}
      </div>
    </div>
  );
};
