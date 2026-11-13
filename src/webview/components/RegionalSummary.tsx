import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { regionalFormsQuery } from "../queries";
import styles from "./RegionalSummary.module.css";

interface RegionalSummaryProps {
  literal: string;
  onOpen: (literal: string) => void;
}

/**
 * The kanji page's link to its regional forms (spec 22): when other regions write the kanji
 * differently, or Japan wrote it differently before its reform, a "Regional forms" link like the
 * page's Stroke order and Component tree ones. The link appearing says the forms differ, so it says
 * nothing more; the view says who and how. When every region writes it alike, one quiet line.
 * Nothing at all for a kanji outside the four regions' lists, or while the answer loads, so the page
 * never jumps for it.
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
  if (!differs)
    return (
      <p className={styles.same}>
        Written the same way in China, Hong Kong, Taiwan and Japan
      </p>
    );
  return (
    <Button className={styles.summary} onPress={() => onOpen(literal)}>
      <span aria-hidden="true">🌏</span>
      Regional forms
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Button>
  );
};
