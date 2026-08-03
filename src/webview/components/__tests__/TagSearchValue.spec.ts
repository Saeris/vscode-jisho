import { describe, expect, it } from "vitest";
import {
  TagSearchValue,
  partialTag,
  textOf,
  tokensOf
} from "../TagSearchValue";

/** Build a value by "typing" text into an empty field, the way the field itself would. */
const typed = (text: string): TagSearchValue =>
  new TagSearchValue([]).replaceRange(
    { index: 0, offset: 0 },
    { index: 0, offset: 0 },
    text
  );

describe("tag search value", () => {
  it("turns a recognised #tag into a token", () => {
    // WHY (#27): the token is what makes a tag feel like a filter rather than a string — it is
    // atomic, deletable in one keystroke, and carries the resolved classifier so no consumer has to
    // re-parse the display text.
    const value = typed("#jlpt-n5");
    const tokens = tokensOf(value);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].id).toBe("jlpt-n5");
    expect(tokens[0].kind).toBe("jlpt");
  });

  it("leaves an unrecognised tag as plain text", () => {
    // WHY: this is what lets the field complete rather than fight. `#jl` is `#jlpt-n5` halfway
    // typed, not an error — tokenising it would freeze a fragment the user is still editing.
    const value = typed("#jl");
    expect(tokensOf(value)).toEqual([]);
    expect(textOf(value)).toBe("#jl");
  });

  it("keeps free text alongside tokens", () => {
    // WHY: `#jlpt-n5 taberu` must mean "N5 words matching taberu". If the text were swallowed into
    // the token, or the token into the text, the query would silently lose half its meaning.
    const value = typed("#jlpt-n5 taberu");
    expect(tokensOf(value).map((c) => c.id)).toEqual(["jlpt-n5"]);
    expect(textOf(value)).toBe("taberu");
  });

  it("only tokenises a # at a word boundary", () => {
    // WHY: a `#` inside a word is not a tag. Without the boundary rule, any text containing one
    // would fragment unpredictably as the user types around it.
    const value = typed("C#jlpt-n5");
    expect(tokensOf(value)).toEqual([]);
  });

  it("tokenises several tags in one query", () => {
    // WHY: filters compose — "N5 verbs" is two classifiers, and each must survive as its own
    // token so either can be removed independently.
    const value = typed("#jlpt-n5 #verb-godan");
    expect(tokensOf(value).map((c) => c.id)).toEqual(["jlpt-n5", "verb-godan"]);
  });

  it("matches tags case-insensitively", () => {
    // WHY: `findClassifier` lowercases, so a tag typed with capitals must resolve to the same
    // classifier a lowercase one does — otherwise the autocomplete offers a tag that then fails to
    // tokenise, which reads as the field being broken.
    expect(tokensOf(typed("#JLPT-N5")).map((c) => c.id)).toEqual(["jlpt-n5"]);
  });
});

describe("partialTag", () => {
  it("reports the fragment the caret sits in, without its #", () => {
    // WHY: this drives the autocomplete. It returns the fragment `matchClassifiers` takes, so the
    // suggestion list is a pure function of where the caret is rather than of extra state.
    expect(partialTag(typed("#jl"))).toBe("jl");
    expect(partialTag(typed("taberu #ver"))).toBe("ver");
  });

  it("reports an empty fragment for a bare #, so every tag is offered", () => {
    // WHY: typing `#` is the request to see what tags exist — the discovery path for someone who
    // does not know the vocabulary. An empty fragment means "show them all".
    expect(partialTag(typed("#"))).toBe("");
  });

  it("reports nothing when the caret is not in a tag", () => {
    // WHY: the autocomplete must not hijack ordinary typing. A caret in plain text has no tag in
    // progress, so there is nothing to suggest.
    expect(partialTag(typed("taberu"))).toBeUndefined();
    expect(partialTag(typed(""))).toBeUndefined();
  });

  it("reports nothing once the tag has become a token", () => {
    // WHY: a completed tag is no longer being typed. Continuing to suggest against it would leave
    // the menu open over a filter the user has already committed to.
    expect(partialTag(typed("#jlpt-n5"))).toBeUndefined();
  });
});
