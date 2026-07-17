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
    "Readings used only in names (people and places), often differing from the on/kun readings.",
  // Conjugation-form labels (WordDetail's table): when each form is actually used.
  "Non-past":
    "Present and future in one form — 'eat(s)' or 'will eat'. Plain style, used with friends and in most writing.",
  "Non-past (polite)":
    "The 〜ます/〜です style — the safe default with strangers, coworkers, and customers.",
  Past: "Plain past, for casual speech and writing.",
  "Past (polite)": "Polite past (〜ました/〜でした).",
  "Te-form":
    "The connector — chains actions (食べて寝る), makes requests (〜てください), and builds the continuous (〜ている).",
  Potential: "Can do — ability or possibility.",
  Passive:
    "Is done (to someone) — also doubles as an honorific in formal speech.",
  Causative: "Make or let someone do.",
  Imperative:
    "Blunt command — strong. Mostly signs, emergencies, and rough speech; prefer 〜てください.",
  Volitional: "Let's / shall we; with と思う it means 'I think I'll…'.",
  "Conditional (〜ば)": "If — the general or logical condition.",
  "Conditional (〜たら)":
    "If / when — the most common conditional in conversation.",
  "Desire (〜たい)":
    "Want to — the result conjugates like an い-adjective (食べたくない).",
  Adverbial:
    "The 〜く form — turns the adjective into an adverb (早く → quickly).",
  Conditional: "If / when (〜なら) — often 'as for…, then…'."
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
