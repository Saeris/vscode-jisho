import { Button } from "react-aria-components";
import { parseExampleMarkup } from "../../shared/exampleLinks";
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
 */
export const ExampleSentence = ({
  markup,
  onOpenWord
}: ExampleSentenceProps): React.ReactElement => (
  <>
    {parseExampleMarkup(markup).map((part, index) =>
      part.kind === "link" ? (
        <Button
          // eslint-disable-next-line react/no-array-index-key -- parts are positional within a sentence
          key={index}
          className={styles.word}
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
