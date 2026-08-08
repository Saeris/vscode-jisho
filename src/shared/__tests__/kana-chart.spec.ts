import { describe, expect, it } from "vitest";
import { GOJUON_ROWS, searchFold } from "../kana";
import { inScript, KANA_CHART, toKatakana, type KanaCell } from "../kana-chart";

const cells = (): KanaCell[] =>
  KANA_CHART.flatMap((section) =>
    section.rows.flatMap((r) => r.cells.filter((c) => c !== undefined))
  );

describe("the kana chart", () => {
  it("keeps every row five columns wide, gaps included", () => {
    // WHY: the chart's whole purpose is that a column is one vowel all the way down. や has no
    // yi/ye and わ has no wi/wu/we, so those cells must stay EMPTY — a row that closed its gaps
    // would slide ゆ under "i" and quietly teach the wrong reading.
    for (const section of KANA_CHART) {
      for (const r of section.rows) {
        expect(r.cells).toHaveLength(section.columns.length);
      }
    }
    const gojuon = KANA_CHART[0];
    const ya = gojuon.rows.find((r) => r.cells[0]?.kana === "や");
    expect(ya?.cells.map((c) => c?.kana)).toEqual([
      "や",
      undefined,
      "ゆ",
      undefined,
      "よ"
    ]);
  });

  it("holds the full modern syllabary and nothing twice", () => {
    // WHY: the count is the cheap guard against a dropped or duplicated line while hand-entering
    // the table — 46 modern base kana plus the two obsolete ones, 25 voiced, 33 digraphs — and a
    // typo'd duplicate would otherwise render as a plausible-looking grid.
    const all = cells().map((c) => c.kana);
    expect(all).toHaveLength(48 + 25 + 33);
    expect(new Set(all).size).toBe(all.length);
  });

  it("marks ゐ and ゑ obsolete, and nothing else", () => {
    // WHY: the flag dims a cell, which is a CLAIM about the language — that you will not meet this
    // kana in modern text. It is true of ゐ/ゑ (dropped in the 1946 reform) and false of ぢ/づ,
    // which are merely rare: つづく and はなぢ are ordinary spellings. Shirabe dims ぢ/づ too; we
    // deliberately do not, so this pins the distinction against someone "fixing" it to match.
    const obsolete = cells()
      .filter((c) => c.obsolete === true)
      .map((c) => c.kana);
    expect(obsolete).toEqual(["ゐ", "ゑ"]);
    for (const kana of ["ぢ", "づ", "を", "ん"]) {
      expect(cells().find((c) => c.kana === kana)?.obsolete).toBeUndefined();
    }
  });

  it("contains every kana the jump rail offers", () => {
    // WHY: the rail (GOJUON_ROWS) and the chart are separate tables by design — one is flat and
    // ordered, the other is 2-D with gaps. Separate tables can drift, and the chart missing a kana
    // the rest of the app treats as a heading is the drift that would matter.
    const all = new Set(cells().map((c) => c.kana));
    for (const kana of GOJUON_ROWS) expect(all).toContain(kana);
  });
});

describe("toKatakana", () => {
  it("converts every kana in the chart", () => {
    // WHY: this is the load-bearing shortcut — katakana is DERIVED rather than typed out, so the
    // +0x60 offset has to hold for all 104 cells, not just the ones anyone would think to spot
    // check. Cross-checked against `searchFold`, which walks the same relation in reverse and was
    // written independently: agreeing with it means the conversion is not just self-consistent.
    for (const { kana } of cells()) {
      const katakana = toKatakana(kana);
      expect(katakana).not.toBe(kana);
      expect(searchFold(katakana)).toBe(searchFold(kana));
    }
  });

  it("converts a digraph's small kana too", () => {
    // WHY: digraphs are the case where a naive first-character conversion would look right in a
    // spot check and be wrong — キゃ rather than キャ.
    expect(toKatakana("きゃ")).toBe("キャ");
    expect(toKatakana("じゅ")).toBe("ジュ");
    expect(toKatakana("ぴょ")).toBe("ピョ");
  });

  it("leaves anything that is not hiragana alone", () => {
    // WHY: the same helper runs over romaji in the cell labels, and a range that overreached would
    // mangle them into CJK.
    expect(toKatakana("kya")).toBe("kya");
    expect(toKatakana("漢字")).toBe("漢字");
  });
});

describe("inScript", () => {
  it("returns the stored kana for hiragana and converts for katakana", () => {
    // WHY: the toggle is the tab's only control, so this is the one branch the whole view turns on.
    expect(inScript("し", "hiragana")).toBe("し");
    expect(inScript("し", "katakana")).toBe("シ");
  });
});
