import { useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Menu,
  MenuItem,
  Popover,
  Text,
  Token,
  TokenField,
  TokenInput,
  TokenFieldValue
} from "react-aria-components";
import { tokenFieldPositionToDOMRange } from "react-aria-components/TokenField";
import type { TokenFieldSegment } from "react-aria-components/TokenField";
import {
  findClassifier,
  matchClassifiers,
  type Classifier
} from "../../shared/classifiers";
import { TagSearchValue, textOf, tokensOf } from "./TagSearchValue";
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
  /**
   * How many results each candidate tag would leave, given the tags already applied. Suggestions
   * that would narrow to zero are dropped — see `suggestions` below.
   */
  refineCounts?: ReadonlyMap<string, number>;
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
 * Built on React Aria's documented TokenField-plus-Autocomplete pattern. That matters: a
 * hand-rolled suggestion list looked right and was not — `Autocomplete` is what routes ↑/↓/Enter
 * into the menu while the caret stays in the field, and getting that wiring by hand meant arrow
 * keys that moved an invisible selection. `Menu` also owns its own focus and scroll behaviour, so
 * the highlight follows the keyboard without a manual `scrollIntoView`.
 *
 * `role="searchbox"` is kept deliberately. The field replaces a `SearchField`, and thirty-five
 * tests plus every keyboard hand-off already address it that way.
 */
export const TagSearchField = ({
  text,
  onChange,
  onOpenTag,
  refineCounts,
  inputRef,
  onKeyDown
}: TagSearchFieldProps): React.ReactElement => {
  // The field always has a ref: `Popover` requires a `triggerRef` and throws on `undefined`, so an
  // optional prop cannot be passed straight through. The caller's ref, when given, is used instead.
  const ownRef = useRef<HTMLDivElement>(null);
  const boxRef = inputRef ?? ownRef;

  // Seeded from `text`, not empty: the query survives the webview document being deallocated (the
  // navigation machine persists it), so on remount there can already be a query to show.
  const [value, setValue] = useState(() => valueOf(text));

  /**
   * Adopt a query set from OUTSIDE the field.
   *
   * Syncing only when the incoming text DIFFERS from what the field shows is what makes both
   * directions work: ordinary typing round-trips to the same string and is skipped, leaving the
   * caret alone, while a genuine external write replaces the content.
   */
  const [lastText, setLastText] = useState(text);
  if (text !== lastText) {
    setLastText(text);
    if (text !== textOf(value)) setValue(valueOf(text));
  }

  const apply = (next: TagSearchValue): void => {
    setValue(next);
    onChange(textOf(next), tokensOf(next));
  };

  /**
   * Guard against React Aria delivering one keydown twice.
   *
   * `useTokenField` routes `onKeyDown` through `useKeyboard`, and a single press arrives as two
   * identical events — same key, same `repeat: false`, same native event object. Nothing in the
   * event data distinguishes them and neither `preventDefault` nor `stopPropagation` helps, since
   * both deliveries originate inside the library. Remembering the native event is what makes the
   * one action here that is NOT idempotent — opening a category — fire once.
   */
  const handledKey = useRef<Event | null>(null);
  const once = (e: React.KeyboardEvent): boolean => {
    if (handledKey.current === e.nativeEvent) return false;
    handledKey.current = e.nativeEvent;
    return true;
  };

  /**
   * Where the `#` the user is typing starts, and the fragment after it.
   *
   * `findText` searching BACKWARD from the caret is React Aria's own idiom for this (their example
   * anchors `@`/`/` mentions the same way). The anchor doubles as the popover's position target, so
   * the menu opens under the tag being typed rather than under the whole field.
   */
  const [anchor, fragment] = useMemo(() => {
    const found = value.findText(
      value.caretPosition,
      TokenFieldValue.Direction.Backward,
      /(?<=^|\s)#/u
    );
    if (found === null) return [null, null] as const;
    return [found, value.slice(found, value.caretPosition).toString()] as const;
  }, [value]);

  const applied = useMemo(
    () => new Set(tokensOf(value).map((c) => c.id)),
    [value]
  );

  /**
   * The candidate tags.
   *
   * Excludes tags already in the box, and — once `refineCounts` is known — any tag that would
   * narrow the results to zero. Offering a combination that yields nothing is worse than offering
   * nothing: it looks like a working filter until you pick it.
   */
  const suggestions = useMemo(() => {
    if (fragment === null) return [];
    const matches = matchClassifiers(fragment, 30, applied);
    if (refineCounts === undefined) return matches;
    return matches.filter((c) => (refineCounts.get(c.id) ?? 1) > 0);
  }, [fragment, applied, refineCounts]);

  /**
   * Remove a token by clicking it.
   *
   * Located by IDENTITY in `value.segments` rather than by matching its text: the same tag can only
   * appear once (already-applied tags are excluded from suggestions), but identity is exact and
   * survives a future where that stops being true.
   *
   * Deletes the token AND a single following space, which is what `complete` inserted — otherwise
   * removing two tags in a row leaves a run of orphaned spaces behind.
   */
  const removeToken = (segment: TokenFieldSegment<Classifier>): void => {
    const index = value.segments.indexOf(segment);
    if (index < 0) return;
    const after = value.segments.at(index + 1);
    const trailing = after?.type === "text" && after.text.startsWith(" ");
    apply(
      value.replaceRange(
        { index, offset: 0 },
        trailing
          ? { index: index + 1, offset: 1 }
          : { index, offset: segment.text.length },
        ""
      )
    );
  };

  /** Replace the fragment under the caret with a chosen tag, as a token plus a trailing space. */
  const complete = (classifier: Classifier): void => {
    if (anchor === null) return;
    setValue((current) => {
      // `replaceRangeWithSegments` inserts the token AND the space that follows it in one edit, so
      // the caret ends up after both. Writing text and letting it re-tokenise left the caret on the
      // far side of the new pill — the "cursor lands before the tag" bug.
      const next = current.replaceRangeWithSegments(
        anchor,
        current.caretPosition,
        [
          { type: "token", text: `#${classifier.id}`, value: classifier },
          { type: "text", text: " " }
        ],
        false
      );
      onChange(textOf(next), tokensOf(next));
      return next;
    });
  };

  return (
    <Autocomplete>
      <div className={styles.wrap}>
        <TokenField
          aria-label="Search the dictionary"
          role="searchbox"
          value={value}
          onChange={apply}
          className={styles.field}
          autoFocus
          onKeyDown={(e) => {
            // Enter on a lone tag opens its list — the keyboard shortcut for browsing to it. Only
            // when the menu is CLOSED; with it open, Autocomplete's Enter commits the highlighted
            // suggestion, and the two must not collide.
            if (e.key === "Enter" && suggestions.length === 0) {
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
          <TokenInput ref={boxRef} className={styles.input}>
            {(segment) => (
              <Token
                className={styles.token}
                // Click to remove. `onPointerDown` rather than click so the field does not first
                // move the caret into the token being deleted, and `preventDefault` keeps focus in
                // the input — removing a filter is mid-query, not the end of one.
                onPointerDown={(e) => {
                  e.preventDefault();
                  removeToken(segment);
                }}
              >
                {/* The token renders the classifier's LABEL ("N5"), not the raw id, so a committed
                    filter reads the way the browse tree names it. `value` is absent for a token
                    restored from text, so resolve by id as a fallback. */}
                {segment.value?.label ??
                  findClassifier(segment.text)?.label ??
                  segment.text}
                <span
                  className={styles.tokenRemove}
                  title={`Remove ${segment.value?.label ?? segment.text}`}
                  aria-hidden="true"
                >
                  ×
                </span>
              </Token>
            )}
          </TokenInput>
        </TokenField>
        {/* Clears the whole query — text and every tag — in one action. Inside the field's box
            rather than beside it, so it reads as part of the input the way a search field's clear
            affordance always does. Hidden when there is nothing to clear. */}
        {value.segments.length > 0 && value.toString() !== "" ? (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            // Same reasoning as the token's: keep focus in the field so the user can keep typing.
            onPointerDown={(e) => {
              e.preventDefault();
              apply(new TagSearchValue([]));
              boxRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      <Popover
        triggerRef={boxRef}
        isOpen={anchor !== null && suggestions.length > 0}
        isNonModal
        placement="bottom start"
        // "MenuTrigger" so the popover does not steal focus: the caret stays in the field and the
        // menu is driven by `Autocomplete` from there.
        trigger="MenuTrigger"
        className={styles.popover}
        // `null` falls back to the trigger's own rect, which is the right behaviour in the window
        // where the anchor has gone but the popover has not yet closed.
        getTargetRect={(target) =>
          anchor === null
            ? null
            : tokenFieldPositionToDOMRange(
                target,
                anchor
              ).getBoundingClientRect()
        }
      >
        <Menu
          className={styles.suggestions}
          items={suggestions}
          dependencies={[anchor, refineCounts]}
        >
          {(item: Classifier) => (
            <MenuItem
              id={item.id}
              className={styles.suggestion}
              textValue={item.label}
              onAction={() => complete(item)}
            >
              <Text slot="label" className={styles.suggestionLabel}>
                {item.label}
              </Text>
              <Text slot="description" className={styles.suggestionTag}>
                {refineCounts === undefined
                  ? `#${item.id}`
                  : `#${item.id} · ${(refineCounts.get(item.id) ?? 0).toLocaleString()}`}
              </Text>
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </Autocomplete>
  );
};
