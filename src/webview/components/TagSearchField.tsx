import { useId, useMemo, useRef, useState } from "react";
import { Token, TokenField, TokenInput, Popover } from "react-aria-components";
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
export const TagSearchField = ({
  text,
  onChange,
  onOpenTag,
  inputRef,
  onKeyDown
}: TagSearchFieldProps): React.ReactElement => {
  // The field always has a ref, whether or not the caller wants one: `Popover` requires a
  // `triggerRef` and throws on `undefined`, so an optional prop cannot be passed straight through.
  // The caller's ref, when given, is pointed at the same element below.
  const ownRef = useRef<HTMLDivElement>(null);
  const boxRef = inputRef ?? ownRef;
  // Stable ids so the input can point `aria-activedescendant` at the active option — the combobox
  // contract for announcing a selection the keyboard moved without focus following it.
  const listId = useId();
  const optionId = (id: string): string => `${listId}-${id}`;
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

  /**
   * The highlighted suggestion, driven by ↑/↓ while the caret stays in the field.
   *
   * Focus does NOT move into the menu — that is the combobox pattern, and moving it would mean the
   * next keystroke went to the list instead of continuing to filter it. Tab was reaching the
   * toolbar buttons before the list precisely because the menu was outside the field's focus
   * order, which is the bug this fixes: the keys are handled here, and the list only ever shows
   * which item is active.
   */
  const [active, setActive] = useState(0);
  // Reset whenever the candidate set changes, so the highlight never points past the end of a
  // freshly narrowed list.
  const [lastFragment, setLastFragment] = useState(fragment);
  if (fragment !== lastFragment) {
    setLastFragment(fragment);
    setActive(0);
  }
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0));

  const apply = (next: TagSearchValue): void => {
    setValue(next);
    onChange(textOf(next), tokensOf(next));
  };

  /**
   * Guard against React Aria delivering one keydown twice.
   *
   * `useTokenField` routes `onKeyDown` through `useKeyboard`, and a single press arrives as two
   * identical events — same key, same `repeat: false`, same native event object. Nothing in the
   * event data distinguishes them, so `preventDefault`/`stopPropagation` cannot help: both
   * deliveries originate inside the library. Remembering the native event is what makes an action
   * fire once, which matters for the two that are not idempotent — stepping the highlight, and
   * opening a category.
   */
  const handled = useRef<Event | null>(null);
  const once = (e: React.KeyboardEvent): boolean => {
    if (handled.current === e.nativeEvent) return false;
    handled.current = e.nativeEvent;
    return true;
  };

  /** Replace the fragment under the caret with a chosen tag, which then tokenises itself. */
  const complete = (classifier: Classifier): void => {
    if (fragment === undefined) return;
    const { index, offset } = value.caretPosition;
    // Rewind over the partial `#tag` the user typed, then write the full one in its place. The
    // value's own tokenizer turns it into a token — this does not construct the token by hand, so
    // completion and typing produce identical results by construction.
    const start = { index, offset: offset - fragment.length - 1 };
    const next = value.replaceRange(
      start,
      { index, offset },
      `#${classifier.id} `
    );
    // Put the caret AFTER the new token, not before it. `replaceRange` leaves the caret where the
    // replaced text began, and because the inserted text becomes a token, that position lands on
    // the far side of the pill — so the next thing typed would appear before the tag the user just
    // picked. The trailing space is its own text segment; the caret belongs at the end of it.
    const last = next.segments.length - 1;
    const tail = next.segments.at(last);
    apply(
      next.withCaretPosition({
        index: last,
        offset: tail?.type === "text" ? tail.text.length : 0
      })
    );
    // Keep typing in the field — completing a tag is mid-query, not the end of one.
    boxRef.current?.focus();
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
          // While the menu is open it owns ↑/↓/Enter/Escape — the combobox contract. These are
          // handled HERE rather than by moving focus into the list, so typing keeps filtering.
          if (suggestions.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!once(e)) return;
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive(
                (activeIndex + step + suggestions.length) % suggestions.length
              );
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              if (!once(e)) return;
              complete(suggestions[activeIndex]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              // Dismiss by dropping the `#`, which is what closes the menu — there is no separate
              // "menu open" flag to clear, since the menu IS the fragment under the caret.
              const { index, offset } = value.caretPosition;
              apply(
                value.replaceRange(
                  { index, offset: offset - (fragment?.length ?? 0) - 1 },
                  { index, offset },
                  ""
                )
              );
              return;
            }
          }
          // Enter on a lone tag opens its list — the keyboard equivalent of browsing to it, and
          // the reason `#jlpt-n5` is worth typing rather than navigating four taps deep.
          if (e.key === "Enter") {
            const tags = tokensOf(value);
            if (tags.length === 1 && textOf(value) === "") {
              e.preventDefault();
              if (!once(e)) return;
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
        <TokenInput
          ref={boxRef}
          className={styles.input}
          // Announces the keyboard-highlighted suggestion without moving focus to it.
          aria-activedescendant={
            suggestions.length > 0
              ? optionId(suggestions[activeIndex].id)
              : undefined
          }
          aria-controls={suggestions.length > 0 ? listId : undefined}
        >
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
          triggerRef={boxRef}
        >
          {/*
            A plain listbox, not React Aria's `ListBox`. The caret never leaves the input — this is
            a DISPLAY of which suggestion is active, not an interactive list — and RAC's own
            component brings key handling of its own, which double-advanced every ArrowDown because
            both it and the field moved the selection.

            `aria-activedescendant` on the input is the combobox contract for exactly this: focus
            stays put, and the active option is announced from here.
          */}
          <ul
            id={listId}
            role="listbox"
            aria-label="Matching tags"
            className={styles.suggestions}
          >
            {suggestions.map((item, i) => (
              <li
                key={item.id}
                id={optionId(item.id)}
                role="option"
                aria-selected={i === activeIndex}
                className={styles.suggestion}
                // Pointer-down rather than click: click fires after the input has already lost
                // focus, and the caret position `complete` reads would be stale by then.
                onPointerDown={(e) => {
                  e.preventDefault();
                  complete(item);
                }}
              >
                <span className={styles.suggestionLabel}>{item.label}</span>
                <span className={styles.suggestionTag}>#{item.id}</span>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </div>
  );
};
