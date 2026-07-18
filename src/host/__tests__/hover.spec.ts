import { describe, expect, it } from "vitest";
import { japaneseRunAt, wordAt } from "../hover";

describe("japaneseRunAt", () => {
  it("finds the contiguous Japanese run around the cursor in mixed text", () => {
    // WHY: hovers fire on every mouse pause in any file — the run finder is the cheap gate that
    // keeps English text from ever reaching the tokenizer or the database.
    const line = "I ate 食べました yesterday";
    expect(japaneseRunAt(line, 8)).toEqual({ text: "食べました", start: 6 });
    expect(japaneseRunAt(line, 2)).toBeNull();
    expect(japaneseRunAt(line, 20)).toBeNull();
  });

  it("counts a cursor just past the run's last character as inside it", () => {
    // WHY: hovering the tail edge of a word is common; treating it as a miss makes the hover
    // flicker at word boundaries.
    const line = "食べる!";
    expect(japaneseRunAt(line, 3)).toEqual({ text: "食べる", start: 0 });
  });

  it("keeps ー and 々 inside runs", () => {
    // WHY: these aren't kana but occur mid-word (コーヒー, 人々) — splitting on them would hover
    // half a word.
    expect(japaneseRunAt("コーヒーを飲む", 2)).toEqual({
      text: "コーヒーを飲む",
      start: 0
    });
    expect(japaneseRunAt("人々が", 1)).toEqual({ text: "人々が", start: 0 });
  });
});

describe("wordAt", () => {
  const segments = [
    { surface: "日本語", lemma: "日本語" },
    { surface: "を", lemma: "を" },
    { surface: "食べました", lemma: "食べる" }
  ];

  it("picks the segment the cursor offset falls in, with its start offset", () => {
    // WHY: the hover must describe the word UNDER the cursor, not the first word of the run —
    // and the start offset is what highlights the right span in the editor.
    expect(wordAt(segments, 0)).toEqual({ segment: segments[0], start: 0 });
    expect(wordAt(segments, 3)).toEqual({ segment: segments[1], start: 3 });
    expect(wordAt(segments, 5)).toEqual({ segment: segments[2], start: 4 });
    expect(wordAt(segments, 99)).toBeNull();
  });
});
