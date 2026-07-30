import { describe, expect, it } from "vitest";
import { hasKanji, isKanjiChar, isKanjiForReading } from "../japanese";

describe("kanji predicates", () => {
  it("gates the tokenizer on a real script transition", () => {
    // WHY: IPADIC finds word boundaries from kanji-kana transitions, so all-kana input segments into
    // garbage. Features check this and fall back rather than acting on bad segmentation.
    expect(hasKanji("日本語を勉強します")).toBe(true);
    expect(hasKanji("にほんごをはなしますか")).toBe(false);
    expect(hasKanji("hello")).toBe(false);
  });

  it("excludes iteration marks from the tokenizer gate", () => {
    // WHY: 々 repeats whatever precedes it — on its own it supplies no script transition, so it
    // cannot be what makes a run tokenizable.
    expect(hasKanji("々")).toBe(false);
    expect(hasKanji("人々")).toBe(true); // 人 is what qualifies it
  });

  it("treats a lookup character and an alignment character DIFFERENTLY on 々", () => {
    // WHY: this is the distinction that used to live as a subtly different character class in each
    // file. 々 has no kanji_characters row, so making it tappable would dead-end the user — but it
    // does carry a reading (人々 → ひとびと), so furigana alignment must keep it inside the kanji run
    // or the reading splits in the wrong place. Both are correct; they are different questions.
    const mark = "々";
    expect(isKanjiChar(mark)).toBe(false);
    expect(isKanjiForReading(mark)).toBe(true);
    // 〆 behaves the same way.
    expect(isKanjiChar("〆")).toBe(false);
    expect(isKanjiForReading("〆")).toBe(true);
  });

  it("includes the CJK compatibility block everywhere", () => {
    // WHY: those codepoints are real kanji a document can contain (and the stroke-SVG work showed
    // they reach us), so every predicate has to accept them.
    const compat = String.fromCodePoint(0xfa47);
    expect(hasKanji(compat)).toBe(true);
    expect(isKanjiChar(compat)).toBe(true);
    expect(isKanjiForReading(compat)).toBe(true);
  });

  it("rejects kana for all three", () => {
    for (const kana of ["ひ", "ヒ", "ー"]) {
      expect(hasKanji(kana)).toBe(false);
      expect(isKanjiChar(kana)).toBe(false);
      expect(isKanjiForReading(kana)).toBe(false);
    }
  });
});
