import { Button } from "react-aria-components";
import type { PartOfSpeech } from "../../shared/messages";
import { parseExampleMarkup } from "../../shared/exampleLinks";
import { useHostSettings } from "../useHostSettings";
import { Ruby } from "./Ruby";
import styles from "./ExampleSentence.module.css";

interface ExampleSentenceProps {
  /** Linkified example markup: `[word](pos:id)` links interleaved with plain runs, ruby inside both. */
  markup: string;
  /** Tap a linked word to open its entry (F1-links, open-by-id). */
  onOpenWord: (id: string) => void;
}

/**
 * Render a linkified example sentence (F1-links): each build-time `[word](pos:id)` link becomes a
 * tappable span that opens that entry, plain runs render as furigana. The link's affordance is quiet
 * — no persistent link chrome (nearly every content word is a link; that would be noise), just a
 * color + underline on hover/focus, matching the headword tap-through on the word page. Word
 * boundaries come from the build-time tokenizer, so the tap targets are whole words (食べました, not
 * a furigana fragment).
 *
 * Words also carry their PART-OF-SPEECH colour (#38), the same hue that word wears in the breakdown
 * bar, in the grammar pills and in the editor — so an example sentence is readable as structure, not
 * just as a string. The POS is in the markup, computed by the build's tokenizer, so this costs no
 * extra data and no tokenization at render time.
 *
 * TAPPABILITY AND COLOUR ARE SEPARATE. A `link` part has a dictionary entry and is both; a `span`
 * part — particles, auxiliaries, unresolved words — is coloured but inert, because opening an entry
 * for は helps nobody while seeing は delimited helps a great deal. Only punctuation and `other`
 * runs are plain `text`.
 */
export const ExampleSentence = ({
  markup,
  onOpenWord
}: ExampleSentenceProps): React.ReactElement => {
  const { colorExamples } = useHostSettings();
  // Omitted entirely when the setting is off, rather than switched to an "off" value: every
  // consumer of `--pos-color` already pairs it with a neutral fallback for the uncategorised case,
  // so the disabled state needs no styling of its own.
  const posOf = (pos: PartOfSpeech): PartOfSpeech | undefined =>
    colorExamples ? pos : undefined;
  return (
    <>
      {parseExampleMarkup(markup).map((part, index) => {
        // eslint-disable-next-line react/no-array-index-key -- parts are positional within a sentence
        const key = index;
        if (part.kind === "link") {
          return (
            <Button
              key={key}
              className={styles.word}
              data-pos={posOf(part.pos)}
              onPress={() => onOpenWord(part.id)}
            >
              <Ruby markup={part.markup} />
            </Button>
          );
        }
        if (part.kind === "span") {
          return (
            <span key={key} className={styles.span} data-pos={posOf(part.pos)}>
              <Ruby markup={part.markup} />
            </span>
          );
        }
        return <Ruby key={key} markup={part.markup} />;
      })}
    </>
  );
};
