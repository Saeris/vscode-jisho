import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import styles from "./Term.module.css";

/**
 * Definitions for jargon that's opaque to newcomers. Keep entries short — a one-line gloss shown
 * on hover/focus. Add sparingly, only for genuinely non-obvious terms.
 */
const GLOSSARY: Record<string, string> = {
  On: "On'yomi — the reading derived from the original Chinese pronunciation, used mostly in compound words.",
  Kun: "Kun'yomi — the native Japanese reading, used when the kanji stands alone or with kana endings.",
  Nanori:
    "Readings used only in names (people and places), often differing from the on/kun readings."
};

interface TermProps {
  /** The label to display; also the glossary key. */
  children: string;
}

/**
 * A label with an on-hover/on-focus definition tooltip, for dictionary jargon. Falls back to plain
 * text when the term isn't in the glossary, so it's always safe to wrap a label.
 */
export const Term = ({ children }: TermProps): React.ReactElement => {
  const definition = GLOSSARY[children];
  if (!definition) return <>{children}</>;
  return (
    <TooltipTrigger delay={300}>
      <Button className={styles.term}>{children}</Button>
      <Tooltip className={styles.tooltip} offset={4}>
        {definition}
      </Tooltip>
    </TooltipTrigger>
  );
};
