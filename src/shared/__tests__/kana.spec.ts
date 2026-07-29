import { describe, expect, it } from "vitest";
import { searchFold, sortKey } from "../kana";

describe("searchFold", () => {
  it("collapses the distinctions a learner plausibly gets wrong", () => {
    // WHY: this is #51's kana tolerance. Raw edit distance is the wrong tool for Japanese — the
    // useful tolerance is normalization, so every spelling a learner might reach for lands on one
    // key: script, kana size, voicing, and the long-vowel mark.
    expect(searchFold("カタカナ")).toBe("かたかな"); // script
    expect(searchFold("がっこう")).toBe("かつこう"); // voicing + small っ
    expect(searchFold("キャンプ")).toBe("きやんふ"); // small ゃ + handakuten
    expect(searchFold("ラーメン")).toBe("らあめん"); // ー resolves to its vowel
    expect(searchFold("コーヒー")).toBe("こおひい");
  });

  it("maps every voiced form onto its base", () => {
    // WHY: stripping marks goes through NFD rather than a hand-written table, so this checks the
    // decomposition actually covers all three voiced rows rather than just the one that was tried.
    expect(searchFold("ばびぶべぼ")).toBe("はひふへほ");
    expect(searchFold("ぱぴぷぺぽ")).toBe("はひふへほ");
    expect(searchFold("がぎぐげご")).toBe("かきくけこ");
    expect(searchFold("ざじずぜぞ")).toBe("さしすせそ");
    expect(searchFold("だぢづでど")).toBe("たちつてと");
  });

  it("leaves a dangling long-vowel mark rather than crashing", () => {
    expect(searchFold("ー")).toBe("");
    expect(searchFold("んー")).toBe("ん");
  });
});

describe("sortKey", () => {
  it("orders by gojūon, not codepoint", () => {
    // WHY: #35 — codepoint order over kana is close to gojūon but small kana interleave (ぁ sorts
    // before あ), so a naive sort scatters conjugated and contracted forms. Folding first puts the
    // base sequence in charge.
    const words = ["ひらがな", "あいさつ", "かんじ", "さくら", "たべる"];
    expect(
      [...words].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    ).toEqual(["あいさつ", "かんじ", "さくら", "たべる", "ひらがな"]);
  });

  it("keeps words that differ only in voicing or kana size distinct", () => {
    // WHY: this is the difference between a sort key and a search key. searchFold deliberately
    // collapses はし/ばし; sorting them to the same key would let a list drop or reorder entries
    // arbitrarily, so the marks come back as a secondary key.
    expect(sortKey("はし")).not.toBe(sortKey("ばし"));
    expect(sortKey("きゃく")).not.toBe(sortKey("きやく"));
    // …but the fold still decides the PRIMARY order: both は-words precede any ひ-word.
    const ordered = ["ばし", "はし", "ひと"].sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b))
    );
    expect(ordered).toEqual(["はし", "ばし", "ひと"]);
  });

  it("sorts katakana and hiragana together", () => {
    // WHY: a browseable list mixes both scripts, and readers expect コーヒー to sit with こ-words
    // rather than in a separate katakana block after every hiragana entry.
    const ordered = ["ラーメン", "あめ", "コーヒー"].sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b))
    );
    expect(ordered).toEqual(["あめ", "コーヒー", "ラーメン"]);
  });
});
