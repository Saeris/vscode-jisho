import { describe, expect, it } from "vite-plus/test";
import type { RegionalGroupDto } from "../../shared/messages";
import {
  columnNames,
  formRows,
  noteRows,
  summaryLine,
  usageRows
} from "../regionalForms";

// Groups as the built database returns them (db.spec.ts checks 学 against the real data).
const learn: RegionalGroupDto = {
  key: "學",
  chars: ["学", "學", "學", "学"],
  old: "學",
  glyphSig: "01101",
  cpSig: "0110",
  strokes: [8, 16, 16, 8, 16],
  tiers: [1, 1, 1, 2],
  readings: [null, null, null, null],
  ranks: [null, null, null, null],
  notes: []
};
const back: RegionalGroupDto = {
  key: "返",
  chars: ["返", "返", "返", "返"],
  glyphSig: "0123",
  cpSig: "0000",
  strokes: [7, 7, 8, 7],
  tiers: [1, 1, 1, 2],
  readings: [null, null, null, null],
  ranks: [null, null, null, null],
  notes: []
};
const one: RegionalGroupDto = {
  key: "一",
  chars: ["一", "一", "一", "一"],
  glyphSig: "0000",
  cpSig: "0000",
  strokes: [1, 1, 1, 1],
  tiers: [1, 1, 1, 2],
  readings: [null, null, null, null],
  ranks: [null, null, null, null],
  notes: []
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

describe("readings and frequency", () => {
  it("labels every rank with its region's corpus, and says when there is none", () => {
    // WHY: the four ranks come from four corpora; a bare "#66" beside a bare "#5" invites a
    // comparison the numbers cannot bear.
    const rows = usageRows({
      ...learn,
      readings: ["xué", "hok6", "xué", "ガク、まな.ぶ"],
      ranks: [66, 84, null, 5]
    });
    expect(rows.map((row) => row.rank)).toEqual([
      "#66 in modern Chinese texts",
      "#84 in Cantonese texts (words.hk)",
      "Not ranked in news and social media (2023)",
      "#5 on Japanese Wikipedia"
    ]);
    expect(rows.map((row) => [row.region, row.char, row.readingName])).toEqual([
      ["China", "学", "Mandarin"],
      ["Hong Kong", "學", "Cantonese"],
      ["Taiwan", "學", "Mandarin"],
      ["Japan", "学", "Japanese"]
    ]);
  });
});

describe("wiktionary's notes", () => {
  it("puts Japan's form first, and a character's cross-language note before its origin", () => {
    // WHY: the reader comes from Japan's 学, so "Simplified from 學" must come before 學's account
    // of its parts, whatever order the database returns them in; and each links to its own section.
    const rows = noteRows({
      ...learn,
      notes: [
        {
          char: "學",
          section: "Chinese",
          text: "Possibly a compound.\nLater, 子 was added."
        },
        { char: "学", section: "Chinese", text: "See 學." },
        { char: "学", section: "Translingual", text: "Simplified from 學." }
      ]
    });
    expect(rows.map((row) => [row.char, row.section, row.paragraphs])).toEqual([
      ["学", "Translingual", ["Simplified from 學."]],
      ["学", "Chinese", ["See 學."]],
      ["學", "Chinese", ["Possibly a compound.", "Later, 子 was added."]]
    ]);
    expect(rows.map((row) => row.url)).toEqual([
      "https://en.wiktionary.org/wiki/%E5%AD%A6#Translingual",
      "https://en.wiktionary.org/wiki/%E5%AD%A6#Chinese",
      "https://en.wiktionary.org/wiki/%E5%AD%B8#Chinese"
    ]);
  });

  it("writes each character in the shape of the region it was quoted for", () => {
    // WHY: 學 is quoted as Hong Kong's form, so it takes Hong Kong's language and font, not the
    // sidebar's Japanese default, like its row in the chart.
    const [row] = noteRows({
      ...learn,
      notes: [{ char: "學", section: "Chinese", text: "A compound." }]
    });
    const chartRow = formRows(learn).find((form) => form.char === "學");
    expect([row?.lang, row?.family]).toEqual(["zh-HK", chartRow?.family]);
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
