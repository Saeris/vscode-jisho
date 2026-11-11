import { describe, expect, it } from "vite-plus/test";
import type { RegionalGroupDto } from "../../shared/messages";
import { columnNames, formRows, summaryLine } from "../regionalForms";

// Groups as the built database returns them (db.spec.ts checks 学 against the real data).
const learn: RegionalGroupDto = {
  key: "學",
  chars: ["学", "學", "學", "学"],
  old: "學",
  glyphSig: "01101",
  cpSig: "0110",
  strokes: [8, 16, 16, 8, 16],
  tiers: [1, 1, 1, 2]
};
const back: RegionalGroupDto = {
  key: "返",
  chars: ["返", "返", "返", "返"],
  glyphSig: "0123",
  cpSig: "0000",
  strokes: [7, 7, 8, 7],
  tiers: [1, 1, 1, 2]
};
const one: RegionalGroupDto = {
  key: "一",
  chars: ["一", "一", "一", "一"],
  glyphSig: "0000",
  cpSig: "0000",
  strokes: [1, 1, 1, 1],
  tiers: [1, 1, 1, 2]
};

describe("a group's distinct forms", () => {
  it("lists Japan's form first, with every region that writes it", () => {
    // WHY: this is a Japanese dictionary, so the reader starts from Japan's form; and 學 is one
    // form for Hong Kong, Taiwan and Japan's old form, so it must be one row naming all three.
    const rows = formRows(learn);
    expect(rows.map((row) => [row.char, columnNames(row.columns)])).toEqual([
      ["学", "China and Japan"],
      ["學", "Hong Kong, Taiwan and Japan's old form"]
    ]);
    expect(rows.map((row) => row.lists)).toEqual([
      ["Level 1 in China", "Kyōiku kanji"],
      ["Common in Hong Kong", "Common in Taiwan"]
    ]);
    expect(rows.map((row) => row.strokes)).toEqual([[8], [16]]);
  });

  it("draws each form in the font of the region that carries it", () => {
    // WHY: the fonts carry a shared form only once (phase 2); a row drawn in another region's
    // family would fall back to a system font.
    expect(formRows(learn).map((row) => row.family)).toEqual([
      "Jisho Sans SC",
      "Jisho Sans HK"
    ]);
  });

  it("flags forms that share a code point but not a glyph", () => {
    // WHY: 返 is one code point drawn four ways: the chart must say so, because a reader comparing
    // code points would conclude the four regions write it alike.
    const rows = formRows(back);
    expect(rows.map((row) => columnNames(row.columns))).toEqual([
      "Japan",
      "China",
      "Hong Kong",
      "Taiwan"
    ]);
    expect(rows.every((row) => row.sharesCodePoint)).toBe(true);
    expect(formRows(learn).some((row) => row.sharesCodePoint)).toBe(false);
  });
});

describe("the kanji page's line", () => {
  it("names the regions that write the kanji differently from Japan", () => {
    // WHY: the line answers the reader's question from the Japanese side: who writes this
    // differently, how many forms there are, and what Japan wrote before the reform.
    expect(summaryLine(learn)).toBe(
      "Written differently in Hong Kong and Taiwan · 2 forms · old form 學"
    );
    expect(summaryLine(back)).toBe(
      "Written differently in China, Hong Kong and Taiwan · 4 forms"
    );
  });

  it("says plainly when every region writes it the same way", () => {
    // WHY: most kanji look the same everywhere; that is worth one quiet line, not a chart.
    expect(summaryLine(one)).toBe(
      "Written the same way in China, Hong Kong, Taiwan and Japan"
    );
  });
});
