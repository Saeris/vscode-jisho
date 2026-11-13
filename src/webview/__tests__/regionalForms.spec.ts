import { describe, expect, it } from "vite-plus/test";
import type { NoteBlock, RegionalGroupDto } from "../../shared/messages";
import {
  columnNames,
  formRows,
  leadLength,
  meaningsOf,
  noteRows,
  summaryLine,
  usageRows
} from "../regionalForms";

const para = (text: string): NoteBlock => ({
  kind: "paragraph",
  text,
  indent: false
});

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
  notes: [],
  meanings: []
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
  notes: [],
  meanings: []
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
  notes: [],
  meanings: []
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
      "#5 on Japanese Wikipedia",
      "#66 in modern Chinese texts",
      "#84 in Cantonese texts (words.hk)",
      "Not ranked in news and social media (2023)"
    ]);
  });

  it("starts with Japan, then the other regions in the chart's order", () => {
    // WHY: this is a Japanese dictionary: the reader comes with Japan's reading in mind and reads
    // the others against it, as the chart above puts Japan's form first.
    const rows = usageRows(learn);
    expect(rows.map((row) => [row.region, row.char, row.readingName])).toEqual([
      ["Japan", "学", "Japanese"],
      ["China", "学", "Mandarin"],
      ["Hong Kong", "學", "Cantonese"],
      ["Taiwan", "學", "Mandarin"]
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
          blocks: [para("Possibly a compound.")]
        },
        { char: "学", section: "Chinese", blocks: [para("See 學.")] },
        {
          char: "学",
          section: "Translingual",
          blocks: [para("Simplified from 學.")]
        }
      ]
    });
    expect(rows.map((row) => [row.char, row.section, row.lead])).toEqual([
      ["学", "Translingual", [para("Simplified from 學.")]],
      ["学", "Chinese", [para("See 學.")]],
      ["學", "Chinese", [para("Possibly a compound.")]]
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
      notes: [{ char: "學", section: "Chinese", blocks: [para("A compound.")] }]
    });
    const chartRow = formRows(learn).find((form) => form.char === "學");
    expect([row?.lang, row?.family]).toEqual(["zh-HK", chartRow?.family]);
  });

  it("shows how the character is formed, with the list under it, and folds the rest", () => {
    // WHY (reported): 國's note runs from its formation into Old Chinese cognates and Cantonese sound
    // changes. The first paragraph answers the view's question (where the shape came from); a list
    // under it belongs to it (商's six shapes); the word's history waits behind "More".
    const shapes: NoteBlock = {
      kind: "list",
      ordered: true,
      items: [{ text: "Inverted triangle.", items: [] }]
    };
    const blocks = [
      para("The formation is unclear. The element atop 丙 varies:"),
      shapes,
      para("In oracle bone script, 賞 is written as 商 over 貝.")
    ];
    expect(leadLength(blocks)).toBe(2);
    const [row] = noteRows({
      ...learn,
      notes: [{ char: "學", section: "Chinese", blocks }]
    });
    expect(row?.lead).toEqual(blocks.slice(0, 2));
    expect(row?.more).toEqual(blocks.slice(2));
  });

  it("keeps a label with the paragraph it labels", () => {
    // WHY: a note can open on the label of a sense; alone, the lead would be a heading over nothing.
    const blocks: NoteBlock[] = [
      { kind: "label", text: "“target” > “prince”" },
      para("Schuessler proposes an Austroasiatic etymology."),
      para("Its derivatives mean “to watch”.")
    ];
    expect(leadLength(blocks)).toBe(2);
  });
});

describe("meanings in Chinese", () => {
  const circle = {
    key: "圓",
    chars: ["圆", "圓", "圓", "円"],
    glyphSig: "0112",
    cpSig: "0112",
    strokes: [10, 13, 13, 4],
    tiers: [1, 1, 1, 2],
    readings: [null, null, null, null],
    ranks: [null, null, null, null],
    notes: [],
    meanings: [
      { char: "円", senses: [{ gloss: "Japanese yen", labels: [] }] },
      { char: "圓", senses: [{ gloss: "circle; round", labels: [] }] }
    ]
  } satisfies RegionalGroupDto;

  it("takes them from a form a Chinese-writing region uses, before Japan's", () => {
    // WHY: 円 is Japan's form, and its Chinese page only says "Japanese yen"; the meanings of the
    // character are on 圓's page, which Hong Kong and Taiwan write.
    expect(meaningsOf(circle)?.char).toBe("圓");
    expect(meaningsOf(circle)?.senses).toEqual([
      { gloss: "circle; round", labels: [] }
    ]);
    expect(meaningsOf(circle)?.url).toBe(
      "https://en.wiktionary.org/wiki/%E5%9C%93#Chinese"
    );
  });

  it("falls back to Japan's form, and is null when no form's page defines it", () => {
    // WHY: a page is better than nothing, and an empty "Meanings in Chinese" heading is worse.
    expect(
      meaningsOf({ ...circle, meanings: circle.meanings.slice(0, 1) })?.char
    ).toBe("円");
    expect(meaningsOf({ ...circle, meanings: [] })).toBeNull();
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
