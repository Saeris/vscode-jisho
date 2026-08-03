import { useMemo, useState } from "react";
import {
  Token,
  TokenField,
  TokenInput,
  ListBox,
  ListBoxItem,
  Popover
} from "react-aria-components";
import { matchClassifiers, type Classifier } from "../../shared/classifiers";
import { TagSearchValue, partialTag, textOf, tokensOf } from "./TagSearchValue";
import styles from "./TagSearchField.module.css";

interface TagSearchFieldProps {
  /**
   * The query's free text, as the app understands it.
   *
   * Not a fully controlled value: the field owns its `TokenFieldValue` (caret and undo history live
   * there), and this is adopted only when it DIVERGES from what the field shows — see the sync
   * below. That is what lets "Look Up Selection", a handwriting pick, or a cross-reference tap set
   * the query from outside without a parent clobbering the caret on every keystroke.
   */
  text: string;
  /** The free text and the tag filters, whenever either changes. */
  onChange: (text: string, tags: Classifier[]) => void;
  /** Enter with exactly one tag and no text: open that tag's list instead of searching. */
  onOpenTag: (id: string) => void;
  inputRef?: React.RefObject<HTMLDivElement | null>;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/**
 * The search box, with `#tag` filters as inline tokens (#27).
 *
 * A `TokenField` rather than a plain input because a tag is not text: it is atomic, it deletes in
 * one keystroke, and it carries a resolved classifier rather than a string a consumer must re-parse.
 * React Aria's own description of the component — "structured search fields, tag inputs" — is this
 * use case exactly.
 *
 * `role="searchbox"` is kept deliberately. The field replaces a `SearchField`, and thirty-five
 * tests plus every keyboard hand-off already address it that way; changing the role would be an
 * invisible break in all of them for no user-facing gain.
 */
/**
 * A field value holding `text`, with any `#tag` in it already tokenised.
 *
 * Built by REPLAYING the text through `replaceRange` rather than constructing segments directly, so
 * it goes through the same `tokenize` path typing does — a query restored from persistence and one
 * typed by hand then produce identical values.
 */
const valueOf = (text: string): TagSearchValue =>
  new TagSearchValue([]).replaceRange(
    { index: 0, offset: 0 },
    { index: 0, offset: 0 },
    text
  );

export const TagSearchField = ({
  text,
  onChange,
  onOpenTag,
  inputRef,
  onKeyDown
}: TagSearchFieldProps): React.ReactElement => {
  // Seeded from `text`, not empty: the query survives the webview document being deallocated (the
  // navigation machine persists it), so on remount there can already be a query to show. Starting
  // empty and waiting for a CHANGE would never fire, because the prop is correct from the first
  // render — that is precisely how the restore path broke.
  const [value, setValue] = useState(() => valueOf(text));

  /**
   * Adopt a query set from OUTSIDE the field.
   *
   * The field owns its value — the caret position and undo history live in it, and a parent
   * round-tripping a string on every keystroke would destroy both. But the query can also be
   * written by things that are not this field: "Jisho: Look Up Selection" from the editor, a
   * handwriting pick, a cross-reference tap. Those go through the navigation machine and arrive
   * here as a changed `text`.
   *
   * Syncing only when the incoming text DIFFERS from what the field already shows is what makes
   * both work: ordinary typing round-trips to the same string and is skipped, so the caret is left
   * alone, while a genuine external write replaces the content. Rendering-phase state adjustment
   * rather than an effect — React's documented pattern for deriving state from props, and it avoids
   * the extra render an effect would cost on every external write.
   */
  const [lastText, setLastText] = useState(text);
  if (text !== lastText) {
    setLastText(text);
    if (text !== textOf(value)) setValue(valueOf(text));
  }

  // The tag fragment under the caret, if any — `undefined` closes the menu. Derived rather than
  // held in state so the suggestions cannot disagree with where the caret actually is.
  const fragment = partialTag(value);
  const suggestions = useMemo(
    () => (fragment === undefined ? [] : matchClassifiers(fragment, 8)),
    [fragment]
  );

  const apply = (next: TagSearchValue): void => {
    setValue(next);
    onChange(textOf(next), tokensOf(next));
  };

  /** Replace the fragment under the caret with a chosen tag, which then tokenises itself. */
  const complete = (classifier: Classifier): void => {
    if (fragment === undefined) return;
    const { index, offset } = value.caretPosition;
    // Rewind over the partial `#tag` the user typed, then write the full one in its place. The
    // value's own tokenizer turns it into a token — this does not construct the token by hand, so
    // completion and typing produce identical results by construction.
    const start = { index, offset: offset - fragment.length - 1 };
    apply(value.replaceRange(start, { index, offset }, `#${classifier.id} `));
  };

  return (
    <div className={styles.wrap}>
      <TokenField
        aria-label="Search the dictionary"
        role="searchbox"
        value={value}
        onChange={apply}
        className={styles.field}
        autoFocus
        onKeyDown={(e) => {
          // Enter on a lone tag opens its list — the keyboard equivalent of browsing to it, and
          // the reason `#jlpt-n5` is worth typing rather than navigating four taps deep.
          if (e.key === "Enter") {
            const tags = tokensOf(value);
            if (tags.length === 1 && textOf(value) === "") {
              e.preventDefault();
              onOpenTag(tags[0].id);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      >
        {/* The ref goes HERE, not on the TokenField: `TokenInput` is the contenteditable that
            carries `role="searchbox"` and takes focus, while the TokenField around it is a plain
            wrapper whose `.focus()` is a no-op. */}
        <TokenInput ref={inputRef} className={styles.input}>
          {(segment) => (
            <Token className={styles.token}>
              {segment.value?.label ?? segment.text}
            </Token>
          )}
        </TokenInput>
      </TokenField>

      {suggestions.length > 0 ? (
        <Popover
          className={styles.popover}
          isNonModal
          // Keeps focus in the field while the menu is open, so typing continues to filter it
          // rather than the menu stealing the caret.
          isOpen
          triggerRef={inputRef}
        >
          <ListBox
            aria-label="Matching tags"
            className={styles.suggestions}
            selectionMode="single"
            onAction={(key) => {
              const chosen = suggestions.find((c) => c.id === String(key));
              if (chosen) complete(chosen);
            }}
            items={suggestions}
          >
            {(item: Classifier) => (
              <ListBoxItem
                id={item.id}
                textValue={item.label}
                className={styles.suggestion}
              >
                <span className={styles.suggestionLabel}>{item.label}</span>
                <span className={styles.suggestionTag}>#{item.id}</span>
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      ) : null}
    </div>
  );
};
