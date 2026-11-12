import { describe, expect, it } from "vite-plus/test";
import type { RegionalGroupDto } from "../messages";
import {
  DEFAULT_FILTERS,
  PATTERNS,
  SPLITS,
  filterRegional,
  splitLabel,
  type RegionalFilters
} from "../regionalBrowse";

const group = (
  fields: Partial<RegionalGroupDto> & Pick<RegionalGroupDto, "key" | "chars">
): RegionalGroupDto => ({
  glyphSig: "0000",
  cpSig: "0000",
  strokes: [null, null, null, null],
  tiers: [0, 0, 0, 0],
  readings: [null, null, null, null],
  ranks: [null, null, null, null],
  notes: [],
  ...fields
});

// As the built database has them (db.spec.ts checks the real list).
const learn = group({
  key: "學",
  chars: ["学", "學", "學", "学"],
  old: "學",
  glyphSig: "01101",
  strokes: [8, 16, 16, 8, 16],
  tiers: [1, 1, 1, 2],
  readings: ["xué", "hok6", "xué", "ガク、まな.ぶ"],
  ranks: [66, 84, 93, 5]
});
const back = group({
  key: "返",
  chars: ["返", "返", "返", "返"],
  glyphSig: "0123",
  strokes: [7, 7, 8, 7],
  tiers: [1, 1, 1, 1],
  readings: ["fǎn", "faan2", "fǎn", "ヘン、かえ.す"],
  ranks: [1000, 900, 800, 400]
});
const mountain = group({
  key: "山",
  chars: ["山", "山", "山", "山"],
  glyphSig: "0001",
  strokes: [3, 3, 3, 3],
  tiers: [1, 1, 1, 2],
  readings: ["shān", "saan1", "shān", "サン、やま"],
  ranks: [200, 150, 180, 30]
});
const write = group({
  key: "書",
  chars: ["书", "書", "書", "書"],
  glyphSig: "0111",
  strokes: [4, 10, 10, 10],
  tiers: [1, 1, 1, 2],
  readings: ["shū", "syu1", "shū", "ショ、か.く"],
  ranks: [300, 250, 260, null]
});
const groups = [learn, back, mountain, write];

// In the default order, Japan's frequency: 学 #5, 山 #30, 返 #400, then 書, which is unranked here.
const keys = (filters: Partial<RegionalFilters>): string[] =>
  filterRegional(groups, { ...DEFAULT_FILTERS, ...filters }).map((g) => g.key);

describe("the difference patterns", () => {
  it("names all thirteen ways four regions split into two or three forms, each differently", () => {
    // WHY: the label is all a reader picks a pattern by; two splits named alike could not be told
    // apart, and a missing split could not be chosen at all.
    expect(new Set(SPLITS.map(splitLabel)).size).toBe(13);
    expect(new Set(PATTERNS.map((p) => p.label)).size).toBe(PATTERNS.length);
    expect(splitLabel("0001")).toBe("Japan alone differs");
    expect(splitLabel("0110")).toBe(
      "China and Japan versus Hong Kong and Taiwan"
    );
    expect(splitLabel("0012")).toBe("Only China and Hong Kong agree");
  });

  it("filters by the number of forms or by one exact split, over the four regions only", () => {
    // WHY: 学 is two forms split China and Japan against Hong Kong and Taiwan; its fifth digit (the
    // old form) must not count as a region, or 学 would read as a three-form character.
    expect(keys({ pattern: "2" })).toEqual(["學", "山", "書"]);
    expect(keys({ pattern: "0110" })).toEqual(["學"]);
    expect(keys({ pattern: "4" })).toEqual(["返"]);
    expect(keys({ pattern: "1" })).toEqual([]);
  });
});

describe("the other filters", () => {
  it("keeps a group on any of the chosen lists, the kyōiku kanji counted as jōyō", () => {
    // WHY: the kyōiku kanji are stored as Japan's level 2, but every one is also a jōyō kanji;
    // filtering to jōyō must not drop the ones taught in school.
    expect(keys({ lists: ["joyo"] })).toEqual(["學", "山", "返", "書"]);
    expect(keys({ lists: ["kyoiku"] })).toEqual(["學", "山", "書"]);
    expect(keys({ lists: ["old"] })).toEqual(["學"]);
  });

  it("reads the stroke range in the chosen region", () => {
    // WHY: Taiwan writes 返 with 8 strokes and Japan with 7; a range set for Taiwan must use
    // Taiwan's count, or the filter answers a question the reader did not ask.
    expect(keys({ region: 2, strokes: [8, 8] })).toEqual(["返"]);
    expect(keys({ region: 3, strokes: [8, 8] })).toEqual(["學"]);
  });
});

describe("the search", () => {
  it("finds a group by any form it writes, the old form too", () => {
    // WHY: a reader who meets 學 in a Taiwanese text has no Japanese form to type; and 眞 is written
    // nowhere today, only as Japan's old form of 真, so it is found through that column alone.
    expect(keys({ search: "學" })).toEqual(["學"]);
    expect(keys({ search: "书" })).toEqual(["書"]);
    const truth = group({
      key: "眞",
      chars: ["真", "真", "真", "真"],
      old: "眞"
    });
    expect(
      filterRegional([truth, ...groups], {
        ...DEFAULT_FILTERS,
        search: "眞"
      }).map((g) => g.key)
    ).toEqual(["眞"]);
  });

  it("finds a group by code point, with or without U+", () => {
    expect(keys({ search: "U+5B66" })).toEqual(["學"]);
    expect(keys({ search: "8fd4" })).toEqual(["返"]);
  });

  it("finds a reading without its tone marks, and Japanese readings by kana or romaji", () => {
    // WHY: few readers can type ǎ or é, and Japanese readings are stored in katakana and
    // hiragana with a dot before the okurigana; none of that should decide whether 学 is found.
    expect(keys({ search: "fan" })).toEqual(["返"]);
    expect(keys({ search: "hok" })).toEqual(["學"]);
    expect(keys({ search: "がく" })).toEqual(["學"]);
    expect(keys({ search: "gaku" })).toEqual(["學"]);
    expect(keys({ search: "まなぶ" })).toEqual(["學"]);
  });

  it("keeps voicing marks: がく does not find か.く", () => {
    // WHY: dropping the voicing marks would make "gaku" find 書 (か.く, to write), a different
    // reading altogether.
    expect(keys({ search: "gaku" })).not.toContain("書");
  });
});

describe("the sort", () => {
  it("ranks by the chosen region's corpus, with unranked forms last", () => {
    // WHY: each region's rank is from its own corpus; and a form a corpus does not rank is not the
    // most common, so it must not sort first.
    expect(keys({ sort: "frequency", region: 3 })).toEqual([
      "學",
      "山",
      "返",
      "書"
    ]);
    expect(keys({ sort: "frequency", region: 1 })).toEqual([
      "學",
      "山",
      "書",
      "返"
    ]);
  });

  it("breaks a tie by the chosen region's form, not the group's name", () => {
    // WHY: the reader sees Japan's forms. 学's group is named 學 (U+5B78), after 孩 (U+5B69), but
    // Japan writes 学 (U+5B66), before 孩; ordering ties by the names would look arbitrary.
    const child = group({
      key: "孩",
      chars: ["孩", "孩", "孩", "孩"],
      strokes: [8, 8, 8, 8]
    });
    expect(
      filterRegional([child, learn], {
        ...DEFAULT_FILTERS,
        sort: "strokes",
        region: 3
      }).map((g) => g.chars[3])
    ).toEqual(["学", "孩"]);
  });

  it("orders equal stroke counts by code point, so the order never changes between loads", () => {
    expect(keys({ sort: "strokes", region: 3 })).toEqual([
      "山",
      "返",
      "學",
      "書"
    ]);
    expect(keys({ sort: "codePoint", region: 0 })).toEqual([
      "書",
      "學",
      "山",
      "返"
    ]);
  });
});
