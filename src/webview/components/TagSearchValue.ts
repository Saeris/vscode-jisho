/**
 * The token model behind `#tag` search (#27).
 *
 * `TokenFieldValue` exposes a `tokenize` hook that runs over text as it is edited, which is exactly
 * the affordance this needs: a `#jlpt-n5` the user finishes typing should BECOME a token, without
 * them having to pick it from a menu, and a token they backspace into should go back to being text.
 * Subclassing is how React Aria intends that to be expressed, so the tokenizing rule lives here
 * rather than as effects reaching into the field's state.
 *
 * The token's `value` is the resolved `Classifier`, so a consumer never re-parses the display text —
 * the same object the browse tree hands to `openWordList`.
 */
import { TokenFieldValue } from "react-aria-components";
// From the subpath: 1.20's root barrel re-exports the `TokenFieldValue` class but not the segment
// TYPES, so the package's own `./TokenField` entry is where these are reachable.
import type { TokenFieldSegment } from "react-aria-components/TokenField";
import { findClassifier, type Classifier } from "../../shared/classifiers";

/**
 * A `#tag` at a word boundary. Requires the `#` to start a segment or follow whitespace so a `#`
 * inside a word (or a lone `#` mid-thought) is left alone, and allows the kebab-case ids the
 * classifier table uses.
 */
const TAG = /(^|\s)(#[a-z0-9-]+)/giu;

export class TagSearchValue extends TokenFieldValue<Classifier> {
  /**
   * Turn any complete, RECOGNISED `#tag` in a run of text into a token.
   *
   * Only recognised ones: `#jlpt-n5` becomes a token because it resolves, while `#jl` stays plain
   * text so the user can keep typing it. That is what makes the field feel like it is completing
   * rather than fighting — an unknown tag is a tag in progress, not an error.
   */
  protected override tokenize(
    text: string
  ): Array<TokenFieldSegment<Classifier>> {
    const segments: Array<TokenFieldSegment<Classifier>> = [];
    let last = 0;
    for (const match of text.matchAll(TAG)) {
      const [whole, lead, tag] = match;
      const classifier = findClassifier(tag);
      if (classifier === undefined) continue;
      const start = match.index + lead.length;
      if (start > last) {
        segments.push({ type: "text", text: text.slice(last, start) });
      }
      segments.push({ type: "token", text: tag, value: classifier });
      last = match.index + whole.length;
    }
    if (last < text.length) {
      segments.push({ type: "text", text: text.slice(last) });
    }
    return segments;
  }
}

/** The classifiers currently tokenised in a value, in order. */
export const tokensOf = (value: TagSearchValue): Classifier[] =>
  value.segments.flatMap((s) =>
    s.type === "token" && s.value !== undefined ? [s.value] : []
  );

/** The free text in a value — everything that is not a tag token. */
export const textOf = (value: TagSearchValue): string =>
  value.segments
    .flatMap((s) => (s.type === "text" ? [s.text] : []))
    .join("")
    .trim();

/**
 * The partial `#tag` the caret sits in, for driving the autocomplete — or `undefined` when the
 * caret is not inside one.
 *
 * Returns the fragment WITHOUT its `#`, since that is what `matchClassifiers` takes. A completed
 * tag has already become a token by then, so anything this returns is by definition still being
 * typed.
 */
export const partialTag = (value: TagSearchValue): string | undefined => {
  const { index, offset } = value.caretPosition;
  // `.at()` rather than `[index]`: indexed access is typed as always-present but is not — the
  // caret can sit past the last segment on an empty field, where `segments` is `[]`.
  const segment = value.segments.at(index);
  if (segment?.type !== "text") return undefined;
  const before = segment.text.slice(0, offset);
  const match = /(?:^|\s)#([a-z0-9-]*)$/iu.exec(before);
  return match?.[1];
};
