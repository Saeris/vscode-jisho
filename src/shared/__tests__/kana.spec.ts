import { describe, expect, it } from "vitest";
import { GOJUON_ROWS, gojuonRow, searchFold, sortKey } from "../kana";

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

describe("gojuonRow", () => {
  it("files a reading under its own kana, folding first", () => {
    // WHY (#54): the jump rail carries the full syllabary, not the ten row-heads — jumping to あ
    // when you want ゆ means scrolling most of the や row by hand. A reader also does not think of
    // dakuten or katakana as changing where a word is indexed, so folding first is what puts
    // だいがく under た and ラーメン under ら.
    expect(gojuonRow("あめ")).toBe("あ");
    expect(gojuonRow("いぬ")).toBe("い");
    expect(gojuonRow("だいがく")).toBe("た");
    expect(gojuonRow("ラーメン")).toBe("ら");
    expect(gojuonRow("ぴあの")).toBe("ひ");
    expect(gojuonRow("きゃく")).toBe("き");
    expect(gojuonRow("ゆき")).toBe("ゆ");
  });

  it("files を and ん under themselves", () => {
    // WHY: both are real headings in a Japanese index. ん heads almost nothing but is kept so the
    // rail's shape never changes between categories.
    expect(gojuonRow("を")).toBe("を");
    expect(gojuonRow("んー")).toBe("ん");
  });

  it("returns undefined for anything that is not kana", () => {
    // WHY: the rail only offers a tab when rows sit behind it. A romaji or kanji-only reading has
    // no gojuon row, and inventing one would scroll the list somewhere arbitrary.
    expect(gojuonRow("")).toBeUndefined();
    expect(gojuonRow("hello")).toBeUndefined();
  });

  it("covers every row the rail offers", () => {
    // WHY: the rail renders GOJUON_ROWS, so a row with no mapping would render a tab that can
    // never activate. Each row's own leading kana must map back to it.
    for (const row of GOJUON_ROWS) expect(gojuonRow(row)).toBe(row);
  });
});
