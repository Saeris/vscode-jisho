import { describe, expect, it } from "vitest";
import { anyPosMatches, asPartOfSpeech, posMatches } from "../pos";

describe("pos compatibility", () => {
  it("matches every verb class to the coarse 'verb'", () => {
    // WHY: the hover resolver rejects a same-reading noun for a verb lemma (死 for する's stem). That
    // only works if all JMdict verb codes count as verbs — godan, ichidan, suru, kuru, transitivity.
    for (const code of ["v1", "v5r", "v5k-s", "vs-i", "vk", "vz", "vi", "vt"]) {
      expect(posMatches("verb", code)).toBe(true);
    }
    // A noun code must NOT satisfy 'verb' — that's the whole point (reject cross-category).
    expect(posMatches("verb", "n")).toBe(false);
    expect(posMatches("verb", "adj-i")).toBe(false);
  });

  it("maps adjective/adverb/noun/particle/auxiliary families", () => {
    expect(posMatches("adjective", "adj-i")).toBe(true);
    expect(posMatches("adjective", "adj-na")).toBe(true);
    expect(posMatches("adverb", "adv-to")).toBe(true);
    expect(posMatches("noun", "n-suf")).toBe(true);
    expect(posMatches("noun", "ctr")).toBe(true);
    expect(posMatches("noun", "v5r")).toBe(false);
    expect(posMatches("particle", "prt")).toBe(true);
    expect(posMatches("auxiliary", "aux-v")).toBe(true);
    expect(posMatches("auxiliary", "cop")).toBe(true);
  });

  it("treats 'other' as no constraint", () => {
    // WHY: when the tokenizer couldn't categorize a word, we must not filter it out on POS.
    expect(posMatches("other", "n")).toBe(true);
    expect(posMatches("other", "v5r")).toBe(true);
  });

  it("anyPosMatches is true when any sense code fits", () => {
    // WHY: an entry has several senses; a verb lemma should match an entry that is a verb in ANY sense.
    expect(anyPosMatches("verb", ["n", "vs-i"])).toBe(true);
    expect(anyPosMatches("verb", ["n", "adj-no"])).toBe(false);
  });

  it("narrows raw tokenizer strings, falling back to 'other'", () => {
    expect(asPartOfSpeech("verb")).toBe("verb");
    expect(asPartOfSpeech("noun")).toBe("noun");
    expect(asPartOfSpeech("gobbledygook")).toBe("other");
  });
});
