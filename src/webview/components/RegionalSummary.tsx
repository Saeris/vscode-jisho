import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { regionalFormsQuery } from "../queries";
import { summaryLine } from "../regionalForms";
import styles from "./RegionalSummary.module.css";

interface RegionalSummaryProps {
  literal: string;
  onOpen: (literal: string) => void;
}

/**
 * The kanji page's line on regional forms (spec 22): when other regions write the kanji
 * differently, a link like the page's Stroke order and Component tree ones, saying who and how many
 * forms; when every region writes it alike, one quiet line. Nothing at all for a kanji outside the
 * four regions' lists, or while the answer loads, so the page never jumps for it.
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
      <span aria-hidden="true">🌏</span>
      <span className={styles.text}>
        Regional forms
        {groups.map((group) => (
          <span key={group.key} className={styles.line}>
            {/* Several groups when Japan writes several characters alike (弁): name each. */}
            {groups.length > 1 ? (
              <span className={styles.key} lang="zh-Hant">
                {group.key}
              </span>
            ) : null}
            {summaryLine(group)}
          </span>
        ))}
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Button>
  );
};
