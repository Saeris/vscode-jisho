import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { FORM_NOTES } from "../../shared/grammar";
import styles from "./Term.module.css";

/**
 * Definitions for jargon that's opaque to newcomers. Keep entries short — a one-line gloss shown
 * on hover/focus. Add sparingly, only for genuinely non-obvious terms.
 *
 * Conjugation-form labels are NOT here: they moved to `FORM_NOTES` in shared/grammar.ts, where the
 * hover can reach them too, and where each gained a worked example. This map keeps the terms that
 * are dictionary jargon rather than grammar (On/Kun/Nanori).
 */
const GLOSSARY: Record<string, string | undefined> = {
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
 * A label with an on-hover/on-focus definition tooltip, for dictionary jargon and conjugation-form
 * labels. Falls back to plain text when the term isn't known, so it's always safe to wrap a label.
 *
 * Two sources: plain glossary strings, and grammar notes (which add a worked example). The example
 * is what makes a form label concrete — "Te-form: the connector" is abstract until you see
 * 食べて寝ます next to it — so it renders when present, kept to one line to keep the tooltip small.
 */
export const Term = ({ children }: TermProps): React.ReactElement => {
  const note = FORM_NOTES[children];
  const definition = GLOSSARY[children] ?? note?.gist;
  if (definition === undefined) return <>{children}</>;
  return (
    <TooltipTrigger delay={300}>
      <Button className={styles.term}>{children}</Button>
      <Tooltip className={styles.tooltip} offset={4}>
        <span>{definition}</span>
        {note ? (
          <span className={styles.example}>
            {note.example.ja} — {note.example.en}
          </span>
        ) : null}
      </Tooltip>
    </TooltipTrigger>
  );
};
