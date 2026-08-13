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
import {
  setTokenFieldSelection,
  tokenFieldPositionToDOMRange
} from "react-aria-components/TokenField";
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
  /**
   * Whether the names dictionary is provisioned. `#name`/`#place` are dropped from the suggestions
   * when it is not — they are backed by a separate ~400MB opt-in download, and a filter that can
   * only ever return nothing is worse than one that is absent.
   */
  namesAvailable?: boolean;
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
  namesAvailable = false,
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

  /**
   * Keep the caret in view, the way a native single-line input does.
   *
   * The field clips instead of wrapping (see `.input` in the stylesheet), and a contenteditable does
   * NOT scroll to follow its own caret — measured, `scrollLeft` stayed at 0 while the text ran to
   * more than twice the field's width, so a long query was typed into characters the reader could
   * not see. A native `<input>` scrolls here for free; this element has to be told.
   *
   * Deferred a frame because the DOM still holds the PREVIOUS text at the moment `apply` runs: the
   * new value renders on React's next commit, and scrolling before that measures the old width.
   */
  const revealCaret = (): void => {
    requestAnimationFrame(() => {
      const el = boxRef.current;
      if (!el) return;
      const selection = el.ownerDocument.getSelection();
      const box = el.getBoundingClientRect();
      if (
        selection === null ||
        selection.rangeCount === 0 ||
        !el.contains(selection.focusNode)
      ) {
        // No caret to follow — a programmatic set, or the clear button. Show the end, which is what
        // a reader expects to be looking at after their last keystroke.
        el.scrollLeft = el.scrollWidth;
        return;
      }
      const caret = selection.getRangeAt(0).getBoundingClientRect();
      // `padding-right` reserves room for the clear button, so the usable right edge stops short of
      // the element's own. Without this the caret hides beneath the button at the end of a query.
      const gutter = parseFloat(getComputedStyle(el).paddingRight) || 0;
      const left = box.left;
      const right = box.right - gutter;
      // BOTH directions. Arrow-left happens to scroll back on its own; arrow-right does not, and
      // measured, the caret ran off the right edge with scrollLeft stuck at 0.
      if (caret.right > right) el.scrollLeft += caret.right - right;
      else if (caret.left < left) el.scrollLeft -= left - caret.left;
    });
  };

  const apply = (next: TagSearchValue): void => {
    setValue(next);
    onChange(textOf(next), tokensOf(next));
    revealCaret();
  };

  /**
   * Select All, which the platform does NOT give this field for free.
   *
   * The box is a contenteditable `TokenField` (#27), not an `<input>`, so the browser has no
   * select-all to apply to it — nothing happens, and on macOS the press instead reads as VS Code's
   * own "Select All". Reported as issue #4; Ctrl+A on Windows and Linux is the same press.
   *
   * VS Code's webview host special-cases exactly Cmd/Ctrl+C, V and X in its keydown handler and
   * forwards everything else to the workbench verbatim (`pre/index.html`, `isCopyPasteOrCut`), which
   * is why copy and paste work in this field and A alone does not. That forwarding is unconditional
   * — it does not consult `defaultPrevented` — so `preventDefault` here is NOT what saves us. What
   * saves us is order: our handler runs first and leaves a real selection behind.
   *
   * The selection goes through React Aria's own `setTokenFieldSelection` rather than
   * `document.execCommand("selectAll")` or a hand-built `Range`, so the tokens stay atomic and the
   * field's internal caret bookkeeping is updated with it.
   */
  const selectAll = (e: React.KeyboardEvent): void => {
    const el = boxRef.current;
    if (!el) return;
    e.preventDefault();
    const { segments } = value;
    const last = segments.length - 1;
    setTokenFieldSelection(
      el,
      { index: 0, offset: 0 },
      // The end of the final segment. An empty field has no segments at all, in which case the
      // start position is already the end and the call is a no-op.
      last < 0
        ? { index: 0, offset: 0 }
        : { index: last, offset: segments[last].text.length }
    );
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
    return matchClassifiers(fragment, 30, applied).filter((c) => {
      // Names and places need a dictionary that may not be downloaded.
      if (
        !namesAvailable &&
        c.kind === "result" &&
        (c.result === "name" || c.result === "place")
      ) {
        return false;
      }
      // Anything that would narrow the results to zero — including nonsense type combinations
      // like `#kanji #verb-godan`, which the host reports as 0 rather than needing a rule here.
      return refineCounts === undefined || (refineCounts.get(c.id) ?? 1) > 0;
    });
  }, [fragment, applied, refineCounts, namesAvailable]);

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
    // Computed from the current `value` and applied through `apply`, NOT inside a `setValue`
    // updater: React may invoke an updater more than once for a single event, and `onChange` is a
    // side effect that must fire exactly once per commit.
    //
    // `replaceRangeWithSegments` inserts the token AND the space that follows it in one edit, so
    // the caret ends up after both. Writing text and letting it re-tokenise left the caret on the
    // far side of the new pill — the "cursor lands before the tag" bug.
    apply(
      value.replaceRangeWithSegments(
        anchor,
        value.caretPosition,
        [
          { type: "token", text: `#${classifier.id}`, value: classifier },
          { type: "text", text: " " }
        ],
        false
      )
    );
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
            // Select All. Idempotent, so it runs without the `once` guard — a doubled delivery just
            // selects the same range twice.
            if ((e.metaKey || e.ctrlKey) && e.key === "a") {
              selectAll(e);
              return;
            }
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
            // Caret movement changes nothing about the VALUE, so `apply` never runs for it — but
            // the field clips, so Home/End and the arrows can walk the caret out of view. Measured:
            // arrow-right left it off the right edge with scrollLeft stuck at 0.
            revealCaret();
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
                {/* Stays a native `title` where everything else moved to `InfoTip`: this glyph is
                    `aria-hidden`, i.e. decoration inside the Token that owns the real interaction.
                    An InfoTip would have to make it focusable to attach its description, which
                    means putting a tab stop on hidden content — a worse outcome than an unstyled
                    tooltip. */}
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
