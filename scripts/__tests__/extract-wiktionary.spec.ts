import { describe, expect, it } from "vite-plus/test";
import { pruneEntry } from "../extract-wiktionary";

describe("pruning a Wiktextract entry", () => {
  it("keeps a one-character entry in the three languages the notes use", () => {
    // WHY: the notes come from the Translingual and Chinese sections, and the cross-check reads
    // Japanese labels; other languages' sections of the same page would only add size.
    const page = (lang: string): unknown => ({
      word: "学",
      lang,
      pos: "character",
      etymology_text: "Simplified from 學."
    });
    expect(
      ["Translingual", "Chinese", "Japanese", "Korean", "Vietnamese"].map(
        (lang) => pruneEntry(page(lang))?.lang ?? null
      )
    ).toEqual(["Translingual", "Chinese", "Japanese", null, null]);
  });

  it("decides by the entry's own word, not a one-character word nested inside it", () => {
    // WHY: nested objects carry `word` keys too. A word of two characters that mentions 学 is not an
    // entry for 学, and keeping it would put a compound's etymology on the character's note.
    expect(
      pruneEntry({
        word: "学校",
        lang: "Japanese",
        pos: "noun",
        derived: [{ word: "学" }]
      })
    ).toBeNull();
  });

  it("keeps only one-character forms, with their labels", () => {
    // WHY: the cross-check reads a form's label (kyūjitai, Traditional-Chinese) to know which
    // characters Wiktionary calls variants; romanizations and readings name no character.
    expect(
      pruneEntry({
        word: "学",
        lang: "Japanese",
        pos: "character",
        senses: [{ glosses: ["study"] }],
        forms: [
          { form: "學", tags: ["kyūjitai"] },
          { form: "gaku", tags: ["romanization"] },
          { form: "まなぶ", tags: ["kun"] }
        ]
      })
    ).toEqual({
      word: "学",
      lang: "Japanese",
      pos: "character",
      forms: [{ form: "學", tags: ["kyūjitai"] }]
    });
  });
});
