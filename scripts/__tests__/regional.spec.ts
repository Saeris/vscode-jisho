import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import {
  buildGroups,
  parseCMap,
  parseCnsTaiwan,
  parseOpenccDict,
  parseUnihan,
  regionalLists,
  regionalReadings,
  reverseDict,
  strokeCounts,
  tghLevel,
  unifiedSignature,
  type OpenccTables,
  type RegionalGroup,
  type RegionalLists,
  type Tuple
} from "../regional";

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────

const dict = (entries: Record<string, string> = {}): Map<string, string[]> =>
  new Map(
    Object.entries(entries).map(([key, value]) => [key, value.split(" ")])
  );

const opencc = (
  tables: Partial<Record<keyof OpenccTables, Record<string, string>>>
): OpenccTables => ({
  st: dict(tables.st),
  ts: dict(tables.ts),
  tw: dict(tables.tw),
  hk: dict(tables.hk),
  jpShinjitai: dict(tables.jpShinjitai)
});

/** Every listed character at tier 1, except where a `chars:tier` pair says otherwise. */
const tiers = (spec = ""): Map<string, number> =>
  new Map(
    spec
      .split(" ")
      .filter(Boolean)
      .map((entry) => {
        const [char = "", tier = "1"] = entry.split(":");
        return [char, Number(tier)];
      })
  );

/** Hong Kong's list as `char:index` pairs: one index for two code points makes them one entry. */
const lists = (spec: {
  cn?: string;
  hk?: string;
  tw?: string;
  jp?: string;
}): RegionalLists => {
  const hkIndex = new Map(
    (spec.hk ?? "")
      .split(" ")
      .filter(Boolean)
      .map((entry, position) => {
        const [char = "", index = `own${position}`] = entry.split(":");
        return [char, index];
      })
  );
  return {
    cn: tiers(spec.cn),
    hk: new Map([...hkIndex.keys()].map((char) => [char, 1])),
    tw: tiers(spec.tw),
    jp: tiers(spec.jp),
    hkIndex
  };
};

const noGlyphs = (): Tuple<Map<number, number>> => [
  new Map(),
  new Map(),
  new Map(),
  new Map()
];

/** One glyph ID per region for each character; the same ID in two regions is the same drawing. */
const glyphs = (
  table: Record<string, Tuple<number>>
): Tuple<Map<number, number>> => {
  const maps = noGlyphs();
  for (const [char, ids] of Object.entries(table))
    for (const [region, id] of ids.entries())
      maps[region]?.set(char.codePointAt(0) ?? 0, id);
  return maps;
};

const group = (groups: RegionalGroup[], key: string): RegionalGroup => {
  const found = groups.find((g) => g.key === key);
  if (!found)
    throw new Error(`no group ${key}: ${groups.map((g) => g.key).join(" ")}`);
  return found;
};

/** The groups showing `char` as Japan's form. */
const japaneseGroups = (groups: RegionalGroup[], char: string): string[] =>
  groups.filter((g) => g.chars[3] === char).map((g) => g.key);

// ── Parsing ───────────────────────────────────────────────────────────────────────────────────────

describe("source parsing", () => {
  it("reads OpenCC dictionaries and reverses them without losing candidates", () => {
    // WHY: one simplified form can stand for several traditional characters (台 for 臺, 檯 and 颱).
    // Dropping all but the first would merge three characters into one group.
    const table = parseOpenccDict("# a comment\n台\t臺 檯 颱\n\n后\t后 後\n");
    expect(table.get("台")).toEqual(["臺", "檯", "颱"]);
    const reversed = reverseDict(table);
    expect(reversed.get("颱")).toEqual(["台"]);
    // A value naming its own key (后 is traditional too) is no variant of itself.
    expect(reversed.get("后")).toBeUndefined();
    expect(reversed.get("後")).toEqual(["后"]);
  });

  it("expands CMap ranges to one glyph ID per code point", () => {
    // WHY: the whole glyph comparison rests on these IDs. A range is consecutive glyphs, so an
    // off-by-one here would make every character in it look like its neighbour.
    const cmap = parseCMap(
      "1 begincidrange\n<4e00> <4e02> 100\nendcidrange\n1 begincidchar\n<4e10> 7\nendcidchar"
    );
    expect(cmap.get(0x4e00)).toBe(100);
    expect(cmap.get(0x4e02)).toBe(102);
    expect(cmap.get(0x4e10)).toBe(7);
    expect(cmap.has(0x4e03)).toBe(false);
  });

  it("reads the Unihan fields the lists and stroke counts need", () => {
    // WHY: kTotalStrokes's second value is the traditional count (Hong Kong, Taiwan and Japan fall
    // back to it), and Adobe's Japanese count is only usable when its entries agree.
    const unihan = parseUnihan([
      [
        "U+8FD4\tkTotalStrokes\t7 8",
        "U+8FD4\tkTGH\t2013:1234",
        "U+5B66\tkJoyoKanji\t2010",
        "U+5B78\tkJoyoKanji\tU+5B66",
        "U+5B78\tkHKGlyph\t0123",
        "U+8457\tkAlternateTotalStrokes\t12:T 11:GJ",
        "U+4E00\tkRSAdobe_Japan1_6\tC+1200+1.1.0 C+1201+1.1.0",
        "U+4E01\tkRSAdobe_Japan1_6\tC+1300+1.1.1 C+1301+1.1.2"
      ].join("\n")
    ]);
    expect(unihan.get("返")).toMatchObject({
      strokes: [7, 8],
      tgh: "2013:1234"
    });
    expect(unihan.get("學")).toMatchObject({ joyo: "U+5B66", hkGlyph: "0123" });
    expect(unihan.get("著")?.altStrokes).toEqual({ T: 12, G: 11, J: 11 });
    expect(unihan.get("一")?.adobeStrokes).toBe(1);
    expect(unihan.get("丁")?.adobeStrokes).toBeUndefined();
  });

  it("puts China's 2013 table in its three levels by index", () => {
    // WHY: the table has no level field; the level is the index range. Level 1 is what a school
    // child learns, so a boundary error moves a common character into the rare tier.
    expect(tghLevel("2013:3500")).toBe(1);
    expect(tghLevel("2013:3501")).toBe(2);
    expect(tghLevel("2013:6500")).toBe(2);
    expect(tghLevel("2013:6501")).toBe(3);
    expect(tghLevel(undefined)).toBe(0);
  });

  it("builds Taiwan's lists from CNS 11643's sources, the common list winning", () => {
    // WHY: CNS names the document a character was first attested in, so about 580 secondary-list
    // characters are credited to the textbook list instead (喫 among them); counting only the
    // secondary source drops them. A character's common-list line wins over any other.
    const toChar = new Map([
      ["1-0001", "學"],
      ["1-0002", "喫"],
      ["1-0003", "溼"],
      ["1-0004", "濕"],
      ["1-0005", "罕"]
    ]);
    const { tiers: taiwan, strokes } = parseCnsTaiwan(
      [
        "1-0001\t常用國字標準字體表(A00001)",
        "1-0002\t國中小教科書常用字(B)",
        "1-0004\t次常用字國字標準字體表(B00001)",
        "1-0003\t次常用字國字標準字體表(B00002)",
        "1-0003\t常用國字標準字體表(A00002)",
        "1-0005\t罕用字體表(C00001)"
      ].join("\n"),
      "1-0001\t16\n1-0002\t12\n1-0002\t99",
      toChar
    );
    expect(taiwan.get("學")).toBe(1);
    expect(taiwan.get("喫")).toBe(2);
    expect(taiwan.get("濕")).toBe(2);
    expect(taiwan.get("溼")).toBe(1);
    expect(taiwan.has("罕")).toBe(false);
    // Several CNS codes can map to one character; the first is its primary encoding.
    expect(strokes.get("喫")).toBe(12);
  });

  it("lists only the jōyō kanji themselves, with kyōiku kanji as tier 2", () => {
    // WHY: kJoyoKanji also marks the traditional variant of a jōyō kanji with a code point (學 →
    // U+5B66). Counting those would put 學 on Japan's list and make Japan write it.
    const unihan = parseUnihan([
      [
        "U+5B66\tkJoyoKanji\t2010",
        "U+5B78\tkJoyoKanji\tU+5B66",
        "U+9B31\tkJoyoKanji\t2010",
        "U+5B66\tkTGH\t2013:0300",
        "U+5B78\tkHKGlyph\t0123"
      ].join("\n")
    ]);
    const result = regionalLists(
      unihan,
      new Map([["學", 1]]),
      new Map([["学", 1]])
    );
    expect(result.jp.get("学")).toBe(2);
    expect(result.jp.get("鬱")).toBe(1);
    expect(result.jp.has("學")).toBe(false);
    expect(result.cn.get("学")).toBe(1);
    expect(result.hkIndex.get("學")).toBe("0123");
  });
});

// ── Glyph signatures ──────────────────────────────────────────────────────────────────────────────

describe("glyph signatures", () => {
  it("counts two regions alike when either typeface draws them alike", () => {
    // WHY: a difference only one family makes is that family's design choice, not a regional
    // convention. Requiring both to agree would report differences no reader of the region sees.
    expect(unifiedSignature([1, 2, 3, 4], [9, 9, 3, 5], [0, 0, 0, 0])).toBe(
      "0012"
    );
  });

  it("joins regions through a chain of agreements", () => {
    // WHY: sans joins China and Hong Kong, serif joins Hong Kong and Taiwan. The union of two
    // equivalences is not transitive, so pairwise answers alone would call China and Taiwan
    // different while each is "the same" as Hong Kong.
    expect(unifiedSignature([1, 1, 2, 3], [5, 6, 6, 7], [0, 0, 0, 0])).toBe(
      "0001"
    );
  });

  it("keeps an unmeasured code point together with itself", () => {
    // WHY: neither font covers it, so there is no evidence of a difference; splitting would show
    // four "different" forms of one unmeasured character.
    const none = [undefined, undefined, undefined, undefined];
    expect(unifiedSignature(none, none, [7, 7, 7, 8])).toBe("0001");
  });
});

// ── Grouping ──────────────────────────────────────────────────────────────────────────────────────

describe("grouping", () => {
  it("groups 学 and 學, with Japan's old form drawn like Hong Kong's and Taiwan's", () => {
    // WHY: the core case. China and Japan reformed the character differently from no one; the old
    // form is what Japan wrote before 1946, and the fifth digit shows it is Taiwan's shape.
    const groups = buildGroups({
      opencc: opencc({
        st: { 学: "學" },
        ts: { 學: "学" },
        jpShinjitai: { 学: "學" }
      }),
      lists: lists({ cn: "学", hk: "學", tw: "學", jp: "学:2" }),
      sans: glyphs({ 学: [10, 10, 10, 10], 學: [20, 20, 20, 20] }),
      serif: noGlyphs()
    });
    expect(groups).toHaveLength(1);
    expect(group(groups, "學")).toEqual({
      key: "學",
      chars: ["学", "學", "學", "学"],
      old: "學",
      glyphSig: "01101",
      cpSig: "0110",
      tiers: [1, 1, 1, 2]
    });
  });

  it("treats two Hong Kong code points with one list index as one entry", () => {
    // WHY: Unihan gives Hong Kong's list index to the list's character and to its variant code
    // points (舉 and 擧). Read as two entries, 擧 becomes a group of its own that repeats 舉's.
    const input = (hk: string) => ({
      opencc: opencc({
        st: { 举: "舉" },
        ts: { 舉: "举" },
        jpShinjitai: { 挙: "擧 舉" }
      }),
      lists: lists({ cn: "举", hk, tw: "舉", jp: "挙" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    const oneEntry = buildGroups(input("舉:3374 擧:3374"));
    expect(oneEntry.map((g) => g.key)).toEqual(["舉"]);
    expect(group(oneEntry, "舉").chars).toEqual(["举", "舉", "舉", "挙"]);
    // Two indexes are two entries, and then 擧 does stand for itself.
    const twoEntries = buildGroups(input("舉:3374 擧:9999"));
    expect(twoEntries.map((g) => g.key).toSorted()).toEqual(["擧", "舉"]);
  });

  it("does not count a Hong Kong variant code point as listed beside another character", () => {
    // WHY: 烟 shares 煙's Hong Kong entry, so the list entering 菸 beside it says 煙 and 菸 are two
    // characters, not that 烟 is a third. Counted, 烟 became a group that repeats China's form.
    const groups = buildGroups({
      opencc: opencc({ st: { 烟: "煙 菸" }, ts: { 煙: "烟", 菸: "烟" } }),
      lists: lists({
        cn: "烟",
        hk: "烟:2401 煙:2401 菸:4000",
        tw: "煙 菸",
        jp: "煙"
      }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(groups.map((g) => g.key).toSorted()).toEqual(["煙", "菸"]);
  });

  it("drops a pre-reform name that repeats another group's forms", () => {
    // WHY: Japan's table names both 鷄 and 雞 as the orthodox forms of 鶏, and no region lists them
    // side by side, so they are one character. Without this, the kanji page for 鶏 would find two
    // groups for one character.
    const groups = buildGroups({
      opencc: opencc({
        st: { 鸡: "雞 鷄" },
        ts: { 雞: "鸡", 鷄: "鸡" },
        jpShinjitai: { 鶏: "鷄 雞" }
      }),
      lists: lists({ cn: "鸡", hk: "雞", tw: "雞", jp: "鶏" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(japaneseGroups(groups, "鶏")).toEqual(["雞"]);
    expect(group(groups, "雞")).toMatchObject({
      chars: ["鸡", "雞", "雞", "鶏"],
      old: "雞"
    });
  });

  it("keeps a group named by a listed character, even when others show all its forms", () => {
    // WHY: 吃 is a character of its own (in Japanese, "stutter"), not only how China writes 喫. The
    // duplicate rule must not drop it because the group 喫 shows 吃 for China, Hong Kong and Taiwan.
    const groups = buildGroups({
      opencc: opencc({
        ts: { 喫: "吃" },
        tw: { 喫: "吃" },
        hk: { 喫: "吃" }
      }),
      lists: lists({ cn: "吃 喫:3", hk: "吃", tw: "吃", jp: "喫" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(group(groups, "吃").chars).toEqual(["吃", "吃", "吃", "吃"]);
    expect(group(groups, "喫").chars).toEqual(["吃", "吃", "吃", "喫"]);
  });

  it("keeps each character a Chinese simplification merged", () => {
    // WHY: 并 stands for 並, 併 and 幷, three characters. A group whose only listed form is China's
    // simplification is one of them, not a duplicate: dropping 幷 would lose that 并 also means 幷.
    const groups = buildGroups({
      opencc: opencc({
        st: { 并: "並 併 幷" },
        ts: { 並: "并", 併: "并", 幷: "并" }
      }),
      lists: lists({ cn: "并", hk: "並 併", tw: "並 併", jp: "並 併" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(groups.map((g) => g.key).toSorted()).toEqual(
      ["併", "幷", "並"].toSorted()
    );
    expect(group(groups, "幷").chars[0]).toBe("并");
  });

  it("joins two orthodox forms only when two tables say they are one character", () => {
    // WHY: Japan's table gives 麵 and 麪 as the orthodox forms of 麺, and Taiwan's writes 麪 as 麵.
    // Split, the noodle character became three groups, one each for 麪, 麵 and 麺, each showing
    // forms no region writes. One table alone is not enough evidence (see the next test).
    const groups = buildGroups({
      opencc: opencc({
        st: { 面: "面 麵" },
        ts: { 麵: "面", 麪: "面" },
        tw: { 麪: "麵" },
        jpShinjitai: { 麺: "麵 麪" }
      }),
      lists: lists({ cn: "面", hk: "麪", tw: "麵", jp: "麺" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(japaneseGroups(groups, "麺")).toHaveLength(1);
    expect(groups.find((g) => g.chars[3] === "麺")?.chars).toEqual([
      "面",
      "麪",
      "麵",
      "麺"
    ]);
  });

  it("does not join a regional pair that Japan's table does not corroborate", () => {
    // WHY: the regional tables also write one character as another. Here Taiwan writes 齶 (palate)
    // as 顎 (jaw), which China keeps apart as 腭 and 颚. Joined on that table alone, the two became
    // one group and China's 颚 was lost.
    const groups = buildGroups({
      opencc: opencc({
        st: { 腭: "齶", 颚: "顎" },
        ts: { 齶: "腭", 顎: "颚" },
        tw: { 齶: "顎" }
      }),
      lists: lists({ cn: "腭 颚", tw: "顎", jp: "顎" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(groups.map((g) => g.key).toSorted()).toEqual(
      ["顎", "齶"].toSorted()
    );
    expect(group(groups, "顎").chars[0]).toBe("颚");
  });

  it("does not let a group one region attests take a form other groups own", () => {
    // WHY: China writes both 針 and 鍼 as 针. A group only Hong Kong lists has too little evidence
    // to claim China's 针, which belongs as much to 針.
    const groups = buildGroups({
      opencc: opencc({ st: { 针: "針 鍼" }, ts: { 針: "针", 鍼: "针" } }),
      lists: lists({ cn: "针", hk: "針 鍼", tw: "針", jp: "針" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(group(groups, "針").chars[0]).toBe("针");
    expect(group(groups, "鍼").chars[0]).not.toBe("针");
  });

  it("finds Japan's old form when the group that named it is gone", () => {
    // WHY: 餠 named a duplicate group (dropped above), but it is still what Japan wrote before
    // the reform. Without this the kanji page for 餅 shows no old form.
    const groups = buildGroups({
      opencc: opencc({
        st: { 饼: "餅" },
        ts: { 餅: "饼" },
        jpShinjitai: { 餅: "餠" }
      }),
      lists: lists({ cn: "饼", hk: "餅", tw: "餅", jp: "餅" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(japaneseGroups(groups, "餅")).toEqual(["餅"]);
    expect(group(groups, "餅").old).toBe("餠");
  });

  it("gives no old form to a character that a reformed shape merely coincides with", () => {
    // WHY: Japan writes 豫 as 予, but 予 was a character before the reform too. 予 → 豫 is the
    // group 豫's old form; giving it to the group 予 would claim 予 was once written 豫.
    const groups = buildGroups({
      opencc: opencc({
        st: { 予: "予 豫" },
        ts: { 豫: "予" },
        jpShinjitai: { 予: "豫" }
      }),
      lists: lists({ cn: "予", hk: "予 豫", tw: "予 豫", jp: "予" }),
      sans: noGlyphs(),
      serif: noGlyphs()
    });
    expect(group(groups, "豫").old).toBe("豫");
    expect(group(groups, "予").old).toBeUndefined();
  });
});

// ── Stroke counts ─────────────────────────────────────────────────────────────────────────────────

describe("readings by region", () => {
  const unihan = parseUnihan([
    [
      "U+884C\tkMandarin\txíng",
      "U+884C\tkTGHZ2013\t131.140:háng 136.100:héng 408.120:xíng",
      "U+884C\tkCantonese\thang4 hong4",
      "U+5B78\tkMandarin\txué",
      "U+5B78\tkCantonese\thok6",
      "U+4E91\tkMandarin\tyún yūn"
    ].join("\n")
  ]);
  const group = (chars: [string, string, string, string]): RegionalGroup => ({
    key: chars[2],
    chars,
    glyphSig: "0000",
    cpSig: "0000",
    tiers: [1, 1, 1, 1]
  });

  it("gives China every reading of a polyphone, the most frequent first", () => {
    // WHY: 行 is read xíng, háng and héng; the 2013 standard lists them alphabetically, which
    // would lead with háng, the rarest, as if it were the character's main reading.
    expect(regionalReadings(group(["行", "行", "行", "行"]), unihan)).toEqual([
      "xíng, háng, héng",
      "hang4, hong4",
      "xíng",
      null
    ]);
  });

  it("gives Taiwan its own Mandarin reading where it differs from China's", () => {
    // WHY: Unihan's second kMandarin value is Taiwan's; showing China's for Taiwan would claim
    // they read it alike.
    const [china, , taiwan] = regionalReadings(
      group(["云", "云", "云", "云"]),
      unihan
    );
    expect([china, taiwan]).toEqual(["yún", "yūn"]);
  });

  it("reads each region's own form, not the group's name", () => {
    // WHY: Hong Kong writes 學, so its Cantonese reading is 學's; China's 学 has no Unihan reading
    // in this fixture, and must not borrow 學's.
    expect(regionalReadings(group(["学", "學", "學", "学"]), unihan)).toEqual([
      null,
      "hok6",
      "xué",
      null
    ]);
  });
});

describe("stroke counts", () => {
  const unihan = parseUnihan([
    "U+8FD4\tkTotalStrokes\t7\nU+8457\tkTotalStrokes\t11"
  ]);
  const returnGroup = (glyphSig: string): RegionalGroup => ({
    key: "返",
    chars: ["返", "返", "返", "返"],
    glyphSig,
    cpSig: "0000",
    tiers: [1, 1, 1, 2]
  });

  it("takes Taiwan's count from Taiwan's own data before Unihan's single count", () => {
    // WHY: Taiwan writes the "movement" radical in 4 strokes, so 返 is 8 there and 7 in China and
    // Japan. Unihan has one count, 7; only Taiwan's data says 8.
    const { strokes } = strokeCounts(returnGroup("0123"), {
      unihan,
      taiwan: new Map([["返", 8]]),
      japan: new Map([["返", 7]])
    });
    expect(strokes[0]).toBe(7);
    expect(strokes[2]).toBe(8);
    expect(strokes[3]).toBe(7);
  });

  it("lends Hong Kong the count of a region that writes the same glyph", () => {
    // WHY: Hong Kong has no official count here. Where it draws the character as Taiwan does, Taiwan's
    // official count is its count too; where the drawing differs, borrowing would be wrong.
    const sources = { unihan, taiwan: new Map([["返", 8]]), japan: new Map() };
    expect(strokeCounts(returnGroup("0110"), sources).strokes[1]).toBe(8);
    expect(strokeCounts(returnGroup("0123"), sources).strokes[1]).toBe(7);
  });

  it("counts Japan's old form from Kanjidic2", () => {
    // WHY: the old form is a Japanese shape, so Japan's count applies (學 is 16).
    const { old } = strokeCounts(
      {
        ...returnGroup("0000"),
        key: "學",
        chars: ["学", "學", "學", "学"],
        old: "學"
      },
      { unihan, taiwan: new Map(), japan: new Map([["學", 16]]) }
    );
    expect(old).toBe(16);
  });
});

// ── The built database ────────────────────────────────────────────────────────────────────────────

// These run against the database `vp run build:data` produces, and skip when it has not been built.
const DB_PATH = join(process.cwd(), "assets", "jisho.db");
const describeIfDb = existsSync(DB_PATH) ? describe : describe.skip;

describeIfDb("regional forms in the built database", () => {
  const formsOf = (
    key: string
  ): Record<string, { char: string; strokes: number | null }> => {
    using db = new DatabaseSync(DB_PATH, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT f.region, f.char, f.strokes FROM regional_forms f
           JOIN regional_groups g ON g.id = f.group_id WHERE g.key = ?`
      )
      .all(key) as { region: string; char: string; strokes: number | null }[];
    return Object.fromEntries(
      rows.map((r) => [r.region, { char: r.char, strokes: r.strokes }])
    );
  };
  const signaturesOf = (key: string): { glyph_sig: string; cp_sig: string } => {
    using db = new DatabaseSync(DB_PATH, { readOnly: true });
    return db
      .prepare("SELECT glyph_sig, cp_sig FROM regional_groups WHERE key = ?")
      .get(key) as { glyph_sig: string; cp_sig: string };
  };

  test("tells 晚 and 晩 apart by code point", () => {
    // WHY: Japan's 晩 is a separate code point, so a search for one never finds the other; this is
    // the difference a reader most needs pointed out.
    expect(formsOf("晚").jp?.char).toBe("晩");
    expect(signaturesOf("晚")).toEqual({ glyph_sig: "00010", cp_sig: "0001" });
  });

  test("shows 返 as one code point drawn four ways, with Taiwan's extra stroke", () => {
    // WHY: the case code points alone cannot show. Each region draws the movement radical its own
    // way, and Taiwan's official count is 8 where China and Japan count 7.
    expect(signaturesOf("返")).toEqual({ glyph_sig: "0123", cp_sig: "0000" });
    const forms = formsOf("返");
    expect(forms.tw?.strokes).toBe(8);
    expect(forms.jp?.strokes).toBe(7);
    expect(forms.cn?.strokes).toBe(7);
  });

  test("shows 有 as Taiwan's glyph alone", () => {
    // WHY: Taiwan's standard draws the first stroke of 有 differently; nothing but the glyph differs.
    expect(signaturesOf("有")).toEqual({ glyph_sig: "0010", cp_sig: "0000" });
  });

  test("gives 學 its old form, drawn like Hong Kong's and Taiwan's", () => {
    // WHY: Japan's pre-reform 學 is the traditional form still written in Hong Kong and Taiwan.
    expect(formsOf("學").old?.char).toBe("學");
    expect(signaturesOf("學").glyph_sig).toBe("01101");
  });

  test("counts 著 with Taiwan's four-stroke grass radical", () => {
    // WHY: Taiwan writes the grass radical in 4 strokes, so its official count is 12, one more than
    // China's and Japan's 11 — a regional difference Unihan's single count hides.
    const forms = formsOf("著");
    expect(forms.tw?.strokes).toBe(12);
    expect(forms.jp?.strokes).toBe(11);
  });

  test("shows a character every region writes the same way as one glyph", () => {
    // WHY: most groups are identical everywhere; a broken comparison shows false differences here.
    expect(signaturesOf("一")).toEqual({ glyph_sig: "0000", cp_sig: "0000" });
  });

  test("sets 冤 apart in Japan, as it is without Korea's link", () => {
    // WHY: with Korea, hanji calls 冤 one glyph everywhere, because Korea's glyph matched both sides.
    // We compare only our four regions, so Japan's own glyph stands apart.
    expect(signaturesOf("冤").glyph_sig).toBe("0001");
  });
});
