import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import {
  parseCounts,
  parseCsv,
  parseHanziDb,
  parseNaerWorkbook,
  rankCounts
} from "../frequency";

/** A minimal .xlsx: one decoy sheet first, then NAER's combined sheet, with shared strings. */
const workbook = (rows: [string, number][]): Uint8Array =>
  zipSync({
    "xl/workbook.xml": strToU8(
      `<workbook><sheets><sheet name="說明" r:id="rId1"/><sheet name="112年語料字頻表" r:id="rId2"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst>${rows.map(([char]) => `<si><t>${char}</t></si>`).join("")}</sst>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData><row r="1"><c r="B1" t="s"><v>0</v></c><c r="C1"><v>999999</v></c></row></sheetData></worksheet>`
    ),
    "xl/worksheets/sheet2.xml": strToU8(
      `<worksheet><sheetData>${rows
        .map(
          ([, count], index) =>
            `<row r="${index + 1}"><c r="B${index + 1}" t="s"><v>${index}</v></c><c r="C${index + 1}"><v>${count}</v></c></row>`
        )
        .join("")}</sheetData></worksheet>`
    )
  });

describe("reading the frequency sources", () => {
  it("reads quoted commas and newlines in a CSV cell", () => {
    // WHY: words.hk counts punctuation too, so its file quotes a comma and a newline as characters;
    // a naive split would shift every later row by a column.
    expect(parseCsv('"\n",102\n",",3451\n學,84\n')).toEqual([
      ["\n", "102"],
      [",", "3451"],
      ["學", "84"]
    ]);
  });

  it("ranks Han characters by count, equal counts sharing a rank", () => {
    // WHY: a rank says how common a character is among characters; punctuation and Latin letters
    // in the counts would push every character down, and ties must not be ordered by accident.
    const ranks = rankCounts([
      ["的", 500],
      [",", 900],
      ["學", 300],
      ["学", 300],
      ["a", 400],
      ["返", 10]
    ]);
    expect([...ranks]).toEqual([
      ["的", 1],
      ["学", 2],
      ["學", 2],
      ["返", 4]
    ]);
  });

  it("takes hanziDB's own ranks", () => {
    // WHY: Jun Da's list is already ranked; recounting would lose its ordering of ties.
    expect(
      parseHanziDb(
        'frequency_rank,charcter,pinyin,definition\n1,的,de,"possessive, adjectival suffix"\n66,学,xué,"learning, knowledge"\n'
      )
    ).toEqual(
      new Map([
        ["的", 1],
        ["学", 66]
      ])
    );
  });

  it("reads Japanese Wikipedia's counts, skipping its total row", () => {
    // WHY: the file's first row is the corpus total under the name "all"; read as a character it
    // would rank first and push every kanji down one.
    expect(
      parseCounts(
        "rank,code_point_hex,char,char_count\n0,0,all,593\n1,5e74,年,168\n2,5b66,学,90\n",
        2,
        3
      )
    ).toEqual(
      new Map([
        ["年", 1],
        ["学", 2]
      ])
    );
  });

  it("reads NAER's combined 2023 sheet by name, not by position", () => {
    // WHY: the workbook holds ten sheets; taking the first would rank Taiwan's characters from a
    // single sub-corpus, or from a notes sheet, without any error.
    expect(
      parseNaerWorkbook(
        workbook([
          ["的", 900],
          ["學", 400]
        ])
      )
    ).toEqual(
      new Map([
        ["的", 1],
        ["學", 2]
      ])
    );
  });
});
