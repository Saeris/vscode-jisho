import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { regionalFormsQuery } from "../queries";
import { formRows, summaryLine } from "../regionalForms";
import { Overprint } from "./Overprint";
import styles from "./RegionalSummary.module.css";

interface RegionalSummaryProps {
  literal: string;
  onOpen: (literal: string) => void;
}

/**
 * The kanji page's line on regional forms (spec 22): when other regions write the kanji
 * differently, a small overprint and a line saying who and how many forms, opening the full view;
 * when every region writes it alike, one quiet line. Nothing at all for a kanji outside the four
 * regions' lists, or while the answer loads, so the page never jumps for it.
 */
export const RegionalSummary = ({
  literal,
  onOpen
}: RegionalSummaryProps): React.ReactElement | null => {
  const { data: groups } = useQuery(regionalFormsQuery(literal));
  if (!groups || groups.length === 0) return null;
  const differs = groups.some(
    (group) =>
      new Set(group.glyphSig.slice(0, 4)).size > 1 || group.old !== undefined
  );
  if (!differs) return <p className={styles.same}>{summaryLine(groups[0])}</p>;
  return (
    <Button className={styles.summary} onPress={() => onOpen(literal)}>
      <span className={styles.groups}>
        {groups.map((group, index) => (
          <span key={group.key} className={styles.group}>
            <Overprint
              rows={formRows(group)}
              size="small"
              name={`kanji-regional-${index}`}
            />
            <span className={styles.line}>
              {/* Several groups when Japan writes several characters alike (弁): name each. */}
              {groups.length > 1 ? (
                <span className={styles.key} lang="zh-Hant">
                  {group.key}
                </span>
              ) : null}
              {summaryLine(group)}
            </span>
          </span>
        ))}
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Button>
  );
};
