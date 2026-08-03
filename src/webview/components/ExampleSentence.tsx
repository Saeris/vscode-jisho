import { Button } from "react-aria-components";
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
 * Linked words also carry their PART-OF-SPEECH colour (#38), the same hue that word wears in the
 * breakdown bar, in the grammar pills and in the editor — so an example sentence is readable as
 * structure, not just as a string. The POS is already in the markup's link target, so this costs no
 * extra data and no tokenization at render time.
 *
 * Only linked words can be coloured: plain runs are exactly the text the build could NOT resolve to
 * an entry, so they have no part of speech to show. Particles are the visible consequence — は and
 * を stay in the foreground colour here, where the breakdown bar does colour them, because the
 * breakdown bar tokenizes at runtime and knows their category.
 */
export const ExampleSentence = ({
  markup,
  onOpenWord
}: ExampleSentenceProps): React.ReactElement => {
  const { colorExamples } = useHostSettings();
  return (
    <>
      {parseExampleMarkup(markup).map((part, index) =>
        part.kind === "link" ? (
          <Button
            // eslint-disable-next-line react/no-array-index-key -- parts are positional within a sentence
            key={index}
            className={styles.word}
            // Omitted entirely when the setting is off, rather than switched to an "off" value:
            // every consumer of `--pos-color` already pairs it with a neutral fallback for the
            // uncategorised case, so the disabled state needs no styling of its own.
            data-pos={colorExamples ? part.pos : undefined}
            onPress={() => onOpenWord(part.id)}
          >
            <Ruby markup={part.markup} />
          </Button>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- parts are positional within a sentence
          <Ruby key={index} markup={part.markup} />
        )
      )}
    </>
  );
};
