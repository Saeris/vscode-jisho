/**
 * Regional forms (spec 22, phase 1): one character as China, Hong Kong, Taiwan and Japan write it.
 *
 * A group is one abstract character: 学 in China and Japan, 學 in Hong Kong and Taiwan, with 學 also
 * Japan's pre-reform form. For each group this works out which form each region writes, whether the
 * regions write it with the same GLYPH (not only the same code point: 返 is one code point drawn
 * four ways), each region's list status, and each form's stroke count.
 *
 * The method is adapted from hanji (https://github.com/sxzz/hanji, MIT, © Kevin Deng): glyph identity
 * from Adobe Source Han's per-region CMaps, and grouping by OpenCC's variant tables checked against
 * each region's own character list. It is a port, not a copy: Korea is left out (spec 22, decision
 * 3), list membership comes from Unihan and CNS 11643 rather than hanji's unlicensed transcription,
 * and Taiwan's stroke counts come from Taiwan's own data (spec 22, phase 0, finding 3).
 *
 * Pure functions, plus one `fetchRegionalSources` that downloads the sources. Licences, all noted in
 * THIRD_PARTY_NOTICES: OpenCC (Apache-2.0), Source Han CMaps (SIL OFL 1.1), Unihan (Unicode License
 * v3), CNS 11643 (Taiwan Open Government Data License 1.0).
 */
import { unzipSync } from "fflate";

// ── Pinned sources ────────────────────────────────────────────────────────────────────────────────
// The same OpenCC and Source Han revisions hanji pins, so its published data stays a usable check on
// ours (scripts/compare-regional.ts). An upstream change should be a deliberate, reviewable bump: the
// fonts drawn must be the ones the CMaps were read from (spec 22, "Fonts and data must not drift").

export const OPENCC_SHA = "f5de4dd6eb96186e5ab9973043e19873ed678288";
const OPENCC_BASE = `https://raw.githubusercontent.com/BYVoid/OpenCC/${OPENCC_SHA}/data/dictionary`;
export const SOURCE_HAN_SANS_SHA = "0b993716f6910f0c8e00f957c767ab3cf5cb7602";
export const SOURCE_HAN_SERIF_SHA = "4356704ff7c68e9a84bf2bd489c9ebe186a9e2ef";
export const UNICODE_VERSION = "17.0.0";
const UNIHAN_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/Unihan.zip`;

/**
 * CNS 11643 publishes at fixed URLs and rebuilds an archive whenever any file in it changes, without
 * always changing the version its `release.txt` names (Properties.zip said 20261028 and was modified
 * on 2026-11-04). A checksum pin would fail the data build every few weeks, so, as for JMdict and
 * Yencken, the build takes the latest, records its date, and checks what matters: Taiwan's common
 * list must keep its official size.
 */
const CNS_PROPERTIES_URL =
  "https://data.cns11643.gov.tw/opendata/Properties.zip";
const CNS_MAPPINGS_URL =
  "https://data.cns11643.gov.tw/opendata/MapingTables.zip";
/** The official size of Taiwan's Standard Form of Common National Characters. */
export const TW_COMMON_SIZE = 4808;

// ── Regions ───────────────────────────────────────────────────────────────────────────────────────

/** The four regions, in the order every tuple and signature uses. */
export const REGIONS = ["cn", "hk", "tw", "jp"] as const;
export type Region = (typeof REGIONS)[number];
export type Tuple<T> = [T, T, T, T];
/** One value per region, as a tuple the type system knows has four entries (`map` forgets that). */
const perRegion = <T>(make: (region: number) => T): Tuple<T> => [
  make(0),
  make(1),
  make(2),
  make(3)
];
const CN = 0;
const JP = 3;
/** The CMap file suffix Adobe uses for each region. */
const CMAP_REGION: Tuple<string> = ["CN", "HK", "TW", "JP"];

// ── Parsing ───────────────────────────────────────────────────────────────────────────────────────

/** An OpenCC dictionary: `key<TAB>value value …`, one entry per line. */
export const parseOpenccDict = (text: string): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const key = line.slice(0, tab);
    const values = line
      .slice(tab + 1)
      .trim()
      .split(" ")
      .filter(Boolean);
    if (key && values.length) map.set(key, values);
  }
  return map;
};

/** Reverse an OpenCC dictionary, keeping every one-to-many candidate. */
export const reverseDict = (
  dict: Map<string, string[]>
): Map<string, string[]> => {
  const reversed = new Map<string, string[]>();
  for (const [key, values] of dict)
    for (const value of values) {
      if (value === key) continue;
      const candidates = reversed.get(value) ?? [];
      if (!candidates.includes(key)) candidates.push(key);
      reversed.set(value, candidates);
    }
  return reversed;
};

const RANGE_BLOCK = /begincidrange([\s\S]*?)endcidrange/g;
const RANGE_ENTRY = /<([\da-f]+)>\s*<([\da-f]+)>\s*(\d+)/gi;
const CHAR_BLOCK = /begincidchar([\s\S]*?)endcidchar/g;
const CHAR_ENTRY = /<([\da-f]+)>\s*(\d+)/gi;

/**
 * An Adobe CMap: code point → glyph ID (CID). Source Han draws all its regions from one shared pool of
 * glyphs, so within one family an equal CID means an identical glyph. Comparing the regions' CMaps
 * therefore says exactly whether they write a character the same way, with no outline comparison.
 */
export const parseCMap = (text: string): Map<number, number> => {
  const map = new Map<number, number>();
  for (const [, body = ""] of text.matchAll(RANGE_BLOCK))
    for (const [, lo = "", hi = "", cid = ""] of body.matchAll(RANGE_ENTRY)) {
      const start = Number.parseInt(lo, 16);
      const end = Number.parseInt(hi, 16);
      for (let cp = start; cp <= end; cp++)
        map.set(cp, Number(cid) + (cp - start));
    }
  for (const [, body = ""] of text.matchAll(CHAR_BLOCK))
    for (const [, cp = "", cid = ""] of body.matchAll(CHAR_ENTRY))
      map.set(Number.parseInt(cp, 16), Number(cid));
  return map;
};

/** The Unihan fields this module reads. */
export interface UnihanEntry {
  /** China's 2013 table (kTGH), as `year:index`; the index gives the level. */
  tgh?: string;
  /** Hong Kong's list of graphemes (kHKGlyph): the entry's index in the list. */
  hkGlyph?: string;
  /** kJoyoKanji: "2010" for a jōyō kanji, or a code point when it is only a variant of one. */
  joyo?: string;
  /** kTotalStrokes: one value, or two (zh-Hans first, zh-Hant second). */
  strokes?: number[];
  /** kAlternateTotalStrokes: count per IRG source letter (G China, H Hong Kong, T Taiwan, J Japan). */
  altStrokes?: Record<string, number>;
  /** kRSAdobe_Japan1_6: the count for the glyph in Adobe's Japanese collection, when its entries agree. */
  adobeStrokes?: number;
  /** kMandarin: the most frequent reading; a second value, when there is one, is Taiwan's. */
  mandarin?: string[];
  /** kTGHZ2013: every reading China's 2013 standard gives a polyphone, alphabetically. */
  mandarinStandard?: string[];
  /** kCantonese: Jyutping readings. */
  cantonese?: string[];
}

const ADOBE_ENTRY = /^C\+\d{1,5}\+\d{1,3}\.(\d{1,2})\.(\d{1,2})$/;

/** `C+3237+37.3.5`: radical drawn in 3 strokes, 5 more besides. Only `C` entries count, and must agree. */
const adobeJapanStrokes = (value: string): number | undefined => {
  let total: number | undefined;
  for (const entry of value.trim().split(" ")) {
    const match = ADOBE_ENTRY.exec(entry);
    if (!match) continue;
    const count = Number(match[1]) + Number(match[2]);
    if (total !== undefined && total !== count) return undefined;
    total = count;
  }
  return total;
};

/** `16:TV 17:G` → { T: 16, V: 16, G: 17 }. */
const alternateStrokes = (
  value: string
): Record<string, number> | undefined => {
  const out: Record<string, number> = {};
  for (const entry of value.trim().split(" ")) {
    const [count, sources] = entry.split(":", 2);
    const total = Number(count);
    if (!sources || !Number.isFinite(total)) continue;
    for (const source of sources) out[source] = total;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Read the fields above from every text file in Unihan.zip. */
export const parseUnihan = (
  files: Iterable<string>
): Map<string, UnihanEntry> => {
  const out = new Map<string, UnihanEntry>();
  for (const text of files)
    for (const line of text.split("\n")) {
      if (!line.startsWith("U+")) continue;
      const [cpText = "", field = "", value = ""] = line.split("\t", 3);
      const char = String.fromCodePoint(Number.parseInt(cpText.slice(2), 16));
      const entry = (): UnihanEntry => {
        let held = out.get(char);
        if (!held) out.set(char, (held = {}));
        return held;
      };
      switch (field) {
        case "kTGH":
          entry().tgh = value.trim();
          break;
        case "kHKGlyph":
          entry().hkGlyph = value.trim();
          break;
        case "kJoyoKanji":
          entry().joyo = value.trim();
          break;
        case "kTotalStrokes":
          entry().strokes = value.trim().split(" ").map(Number);
          break;
        case "kAlternateTotalStrokes": {
          const alt = alternateStrokes(value);
          if (alt) entry().altStrokes = alt;
          break;
        }
        case "kRSAdobe_Japan1_6": {
          const adobe = adobeJapanStrokes(value);
          if (adobe !== undefined) entry().adobeStrokes = adobe;
          break;
        }
        case "kMandarin":
          entry().mandarin = value.trim().split(" ");
          break;
        // `047.150:chóng 481.090:zhòng`: page and position, then the reading.
        case "kTGHZ2013":
          entry().mandarinStandard = [
            ...new Set(
              value
                .trim()
                .split(" ")
                .map((token) => token.slice(token.indexOf(":") + 1))
            )
          ];
          break;
        case "kCantonese":
          entry().cantonese = value.trim().split(" ");
          break;
        default:
      }
    }
  return out;
};

/** CNS code → character, from CNS 11643's Unicode mapping tables (`cns<TAB>hex`). */
export const parseCnsUnicode = (
  tables: Iterable<string>
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const text of tables)
    for (const line of text.split(/\r?\n/)) {
      const [cns, hex] = line.split("\t");
      if (cns && hex)
        out.set(cns, String.fromCodePoint(Number.parseInt(hex, 16)));
    }
  return out;
};

/**
 * The source-document names, in CNS 11643's own wording, that mark Taiwan's lists: the common list,
 * the less-common (secondary) list, and the list of common characters in primary and junior-high
 * textbooks.
 */
const TW_COMMON = "常用國字標準字體表(";
const TW_SECONDARY = "次常用字國字標準字體表(";
const TW_TEXTBOOK = "國中小教科書常用字(";

/**
 * Taiwan's list tier per character (1 common, 2 secondary) from `CNS_source.txt`, and its stroke
 * counts from `CNS_stroke.txt`.
 *
 * `CNS_source.txt` names ONE source per character, where it is first attested, not every list that
 * includes it. The common list comes out whole (4,808, its official size), but the secondary list
 * does not: CNS credits about 580 of its characters to the textbook list instead (喫 among them).
 * The secondary list is therefore the secondary source plus the textbook source: 6,355 characters
 * against the official 6,341, so at most 14 textbook characters are labelled secondary wrongly.
 * Measured against hanji's own Taiwan secondary list, 2,743 of the 2,744 forms it shows are covered.
 */
export const parseCnsTaiwan = (
  sourceText: string,
  strokeText: string,
  toChar: Map<string, string>
): { tiers: Map<string, number>; strokes: Map<string, number> } => {
  const tiers = new Map<string, number>();
  for (const line of sourceText.split(/\r?\n/)) {
    const [cns = "", source = ""] = line.split("\t");
    const char = toChar.get(cns);
    if (char === undefined) continue;
    if (source.includes(TW_COMMON)) tiers.set(char, 1);
    else if (
      (source.includes(TW_SECONDARY) || source.includes(TW_TEXTBOOK)) &&
      !tiers.has(char)
    )
      tiers.set(char, 2);
  }
  const strokes = new Map<string, number>();
  for (const line of strokeText.split(/\r?\n/)) {
    const [cns = "", count] = line.split("\t");
    const char = toChar.get(cns);
    // Several CNS codes can map to one character; the first is the primary encoding.
    if (char !== undefined && count && !strokes.has(char))
      strokes.set(char, Number(count));
  }
  return { tiers, strokes };
};

// ── Glyph signatures ──────────────────────────────────────────────────────────────────────────────

/** Number values by first appearance: [a, b, b, c] → "0112". */
export const partitionSignature = (values: readonly unknown[]): string => {
  const seen = new Map<unknown, number>();
  let signature = "";
  for (const value of values) {
    let index = seen.get(value);
    if (index === undefined) seen.set(value, (index = seen.size));
    signature += String(index);
  }
  return signature;
};

/**
 * Two participants write a character the same way if EITHER typeface gives them one glyph: a
 * difference only one family makes is that family's design choice, not a regional convention. Two
 * participants with the same code point that neither family covers stay together, unmeasured. The
 * union of two equivalences need not be transitive, so the groups are the connected components.
 */
export const unifiedSignature = (
  sans: ReadonlyArray<number | undefined>,
  serif: ReadonlyArray<number | undefined>,
  codePoints: ReadonlyArray<number | undefined>
): string => {
  const parent = sans.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x] ?? x));
  const agree = (
    a: ReadonlyArray<number | undefined>,
    i: number,
    j: number
  ): boolean => a[i] !== undefined && a[i] === a[j];
  for (let i = 0; i < parent.length; i++)
    for (let j = i + 1; j < parent.length; j++) {
      const unmeasured =
        codePoints[i] !== undefined &&
        codePoints[i] === codePoints[j] &&
        sans[i] === undefined &&
        sans[j] === undefined &&
        serif[i] === undefined &&
        serif[j] === undefined;
      if (!agree(sans, i, j) && !agree(serif, i, j) && !unmeasured) continue;
      const [ri, rj] = [find(i), find(j)];
      if (ri !== rj) parent[rj] = ri;
    }
  return partitionSignature(parent.map((_, i) => find(i)));
};

// ── Grouping ──────────────────────────────────────────────────────────────────────────────────────

export interface OpenccTables {
  /** Simplified → traditional candidates. */
  st: Map<string, string[]>;
  /** Traditional → simplified. */
  ts: Map<string, string[]>;
  /** OpenCC standard traditional → Taiwan's form. */
  tw: Map<string, string[]>;
  /** OpenCC standard traditional → Hong Kong's form. */
  hk: Map<string, string[]>;
  /** Japanese shinjitai → orthodox forms (it may name the character itself). */
  jpShinjitai: Map<string, string[]>;
}

/** Each region's list, as the tier of every character it lists (0 or absent: unlisted). */
export interface RegionalLists {
  /** China's 2013 table: level 1, 2 or 3. */
  cn: Map<string, number>;
  /** Hong Kong's list of graphemes: 1. */
  hk: Map<string, number>;
  /** Taiwan: 1 common, 2 secondary. Only the common list generates groups. */
  tw: Map<string, number>;
  /** Japan: 1 jōyō, 2 kyōiku (a jōyō kanji taught in primary school). */
  jp: Map<string, number>;
  /**
   * Hong Kong's list index per character. Unihan gives one index to the list's character and to its
   * variant code points (丟 and 丢, 兌 and 兑), so two characters with one index are one list entry,
   * never two characters the list enters side by side.
   */
  hkIndex: Map<string, string>;
}

export interface GroupingInput {
  opencc: OpenccTables;
  lists: RegionalLists;
  /** Per-region Source Han CMaps, in REGIONS order. */
  sans: Tuple<Map<number, number>>;
  serif: Tuple<Map<number, number>>;
}

export interface RegionalGroup {
  /** The group's name: the traditional form, as hanji keys it. */
  key: string;
  /** The form each region writes, in REGIONS order. */
  chars: Tuple<string>;
  /** Japan's pre-reform form, when Japan writes a reformed shinjitai. */
  old?: string;
  /** Glyph partition over (cn, hk, tw, jp), with a fifth digit for the old form when present. */
  glyphSig: string;
  /** Code-point partition over (cn, hk, tw, jp). */
  cpSig: string;
  /** Each region's list tier for the form it writes (0 = unlisted). */
  tiers: Tuple<number>;
}

const cp = (char: string): number => char.codePointAt(0) ?? 0;

/**
 * Work out the character groups and what each region writes. Ported from hanji's build: keys come
 * from normalizing every listed form to its orthodox form(s); names the tables call one character are
 * joined; each region's form is chosen from OpenCC's candidates by that region's own list.
 */
export const buildGroups = (input: GroupingInput): RegionalGroup[] => {
  const { opencc, lists, sans, serif } = input;
  const listMaps: Tuple<Map<string, number>> = [
    lists.cn,
    lists.hk,
    lists.tw,
    lists.jp
  ];
  /** The lists that GENERATE groups: Taiwan's secondary list only sets a tier. */
  const generates = (region: number, char: string): boolean => {
    const tier = listMaps[region]?.get(char) ?? 0;
    return region === 2 ? tier === 1 : tier > 0;
  };
  const tierOf = (region: number, char: string): number =>
    listMaps[region]?.get(char) ?? 0;
  const listedRegions = (char: string): number =>
    REGIONS.filter((_, region) => tierOf(region, char) > 0).length;
  const generatingRegions = (char: string): number =>
    REGIONS.filter((_, region) => generates(region, char)).length;

  const count = (
    counts: Map<string, number>,
    key: string,
    by: number
  ): void => {
    counts.set(key, (counts.get(key) ?? 0) + by);
  };
  /** How many code points share each Hong Kong index. */
  const hkEntrySize = new Map<string, number>();
  for (const index of lists.hkIndex.values()) count(hkEntrySize, index, 1);
  /** Hong Kong enters the character as an entry of its own, not as one code point of a shared entry. */
  const hkSoleEntry = (char: string): boolean =>
    (hkEntrySize.get(lists.hkIndex.get(char) ?? "") ?? 0) < 2;

  /**
   * OpenCC's variant tables mix a regional way of writing one character (裏 / 裡) with one character
   * standing in for another (Japan writes 缺 as 欠). A region listing both side by side is that region
   * saying they are two characters: the evidence, with no hand-kept exception list. Hong Kong speaks
   * only for its entries: 烟 shares 煙's entry, so the list entering 菸 beside it says 煙 and 菸 are
   * two characters, not that 烟 is a third.
   */
  const listedTogether = (a: string, b: string): boolean =>
    REGIONS.some(
      (_, region) =>
        generates(region, a) &&
        generates(region, b) &&
        (region !== 1 || (hkSoleEntry(a) && hkSoleEntry(b)))
    );

  const twToStandard = reverseDict(opencc.tw);
  const hkToStandard = reverseDict(opencc.hk);
  const standardToCn = reverseDict(opencc.st);
  /**
   * Orthodox form → the shinjitai Japan writes. Several shinjitai can share an orthodox form; Japan's
   * own list breaks the tie (鹽 is 塩, not 䀋).
   */
  const standardToJp = new Map<string, string[]>();
  for (const [shinjitai, orthodox] of opencc.jpShinjitai)
    for (const form of orthodox) {
      if (form === shinjitai) continue;
      const candidates = standardToJp.get(form) ?? [];
      if (!candidates.includes(shinjitai)) candidates.push(shinjitai);
      standardToJp.set(form, candidates);
    }
  for (const candidates of standardToJp.values())
    candidates.sort(
      (a, b) => Number(tierOf(JP, b) > 0) - Number(tierOf(JP, a) > 0)
    );

  /**
   * Any regional form back to its orthodox form(s). 发 normalizes to both 發 and 髮, which are two
   * characters. A form listed among its own simplified-to-traditional values is itself traditional
   * (台, 里, 后) and keeps itself as a key too.
   */
  const normalize = (char: string): string[] => {
    const keys = new Set<string>();
    for (const orthodox of opencc.jpShinjitai.get(char) ?? [])
      keys.add(orthodox);
    for (const standard of twToStandard.get(char) ?? []) keys.add(standard);
    for (const standard of hkToStandard.get(char) ?? []) keys.add(standard);
    const traditional = opencc.st.get(char);
    if (traditional) {
      if (traditional.includes(char)) keys.add(char);
      else for (const value of traditional) keys.add(value);
    }
    if (keys.size === 0) keys.add(char);
    // Folded into a character its own region lists separately: keep a group of its own as well.
    if ([...keys].some((key) => key !== char && listedTogether(char, key)))
      keys.add(char);
    return [...keys];
  };

  // Names the tables call one character (群 and 羣, 唇 and 脣), joined by union-find.
  const nameParent = new Map<string, string>();
  const rootName = (name: string): string => {
    const parent = nameParent.get(name);
    if (!parent || parent === name) return name;
    const root = rootName(parent);
    nameParent.set(name, root);
    return root;
  };
  const sameName = (a: string, b: string): void => {
    const [ra, rb] = [rootName(a), rootName(b)];
    if (ra !== rb) nameParent.set(rb, ra);
  };

  const listedChars = new Set<string>();
  for (const [region, map] of listMaps.entries())
    for (const char of map.keys())
      if (generates(region, char)) listedChars.add(char);

  const keys = new Set<string>();
  for (const char of listedChars) {
    for (const key of normalize(char)) keys.add(key);
    // `JPShinjitaiCharacters` names the character itself beside the orthodox form when the two are
    // one character written two ways: 群 → 群 羣. Unless a region lists them side by side.
    const forms = opencc.jpShinjitai.get(char) ?? [];
    if (forms.includes(char))
      for (const form of forms)
        if (!listedTogether(char, form)) sameName(char, form);
  }

  /**
   * Two orthodox forms are one character when two tables say so independently: Japan's gives both as
   * the orthodox forms of one shinjitai (麺 → 麵 麪), and Taiwan's or Hong Kong's writes one as the
   * other (Taiwan writes 麪 as 麵). One table alone is not enough: the regional tables also write 喫
   * as 吃 and 蔘 as 參, which are two characters each. Unless a region lists them side by side.
   */
  const shinjitaiOf = reverseDict(opencc.jpShinjitai);
  for (const table of [opencc.tw, opencc.hk])
    for (const [standard, forms] of table)
      for (const form of forms)
        if (
          form !== standard &&
          !listedTogether(standard, form) &&
          (shinjitaiOf.get(standard) ?? []).some((shinjitai) =>
            opencc.jpShinjitai.get(shinjitai)?.includes(form)
          )
        )
          sameName(standard, form);

  const choices = (
    fallback: string,
    ...groups: Array<string[] | undefined>
  ): string[] => {
    const forms = [...new Set(groups.flatMap((group) => group ?? []))];
    return forms.length > 0 ? forms : [fallback];
  };
  const mainlandCandidates = (key: string): string[] => {
    const direct = opencc.ts.get(key);
    const reversed = standardToCn.get(key);
    // Simplified-to-traditional holds lexical substitutions too: when both sides are independent
    // mainland entries, the reverse evidence is an alternative but cannot replace the listed form.
    if (
      !direct?.length &&
      generates(CN, key) &&
      reversed?.some((char) => generates(CN, char))
    )
      return choices(key, [key], reversed);
    return choices(key, direct, reversed);
  };
  const candidatesOf = (key: string): Tuple<string[]> => [
    mainlandCandidates(key),
    choices(key, opencc.hk.get(key)),
    choices(key, opencc.tw.get(key)),
    choices(key, standardToJp.get(key))
  ];

  interface Draft {
    key: string;
    chars: Tuple<string>;
    candidates: Tuple<string[]>;
  }
  const drafts: Draft[] = [...keys].map((key) => {
    const candidates = candidatesOf(key);
    return {
      key,
      chars: perRegion((region) => candidates[region][0] ?? key),
      candidates
    };
  });

  /** Prefer a name in the most columns, then listed in the most regions, then the lowest code point. */
  const chooseKey = (
    names: string[],
    chars: Tuple<string>,
    fallback: string[] = []
  ): string => {
    const eligible = names.filter(
      (name) => chars.includes(name) || generatingRegions(name) > 0
    );
    const candidates =
      eligible.length > 0 ? eligible : fallback.length > 0 ? fallback : names;
    return (
      candidates.toSorted(
        (a, b) =>
          chars.filter((char) => char === b).length -
            chars.filter((char) => char === a).length ||
          generatingRegions(b) - generatingRegions(a) ||
          cp(a) - cp(b)
      )[0] ?? names[0]
    );
  };

  // ── Fold drafts that name one character into one group ──
  // Two drafts with the same four columns are one character too (才 and 纔).
  const byColumns = new Map<string, string>();
  for (const draft of drafts) {
    const columns = draft.chars.join("");
    const first = byColumns.get(columns);
    if (first) sameName(first, draft.key);
    else byColumns.set(columns, draft.key);
  }
  const byRoot = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const root = rootName(draft.key);
    byRoot.set(root, [...(byRoot.get(root) ?? []), draft]);
  }
  const roots = new Set(byRoot.keys());
  const namedRoots = new Map<string, Set<string>>();
  for (const [root, group] of byRoot)
    for (const draft of group)
      namedRoots.set(
        draft.key,
        new Set([...(namedRoots.get(draft.key) ?? []), root])
      );
  const rootsOf = (char: string): Set<string> =>
    new Set([
      ...(namedRoots.get(char) ?? []),
      ...normalize(char)
        .map(rootName)
        .filter((root) => roots.has(root))
    ]);

  interface Folded {
    key: string;
    chars: Tuple<string>;
    /** Listed forms this group accounts for without showing them (祕 under 秘): never a group of their own. */
    accounted: Tuple<Set<string>>;
  }
  const folded: Folded[] = [];
  for (const [root, group] of byRoot) {
    const names = [...new Set(group.map((draft) => draft.key))];
    const regional = perRegion((region) => [
      ...new Set(group.flatMap((draft) => draft.candidates[region]))
    ]);
    const ownersOf = (char: string): Set<string> => {
      // A name is its own group's even when that spelling also simplifies other characters (台, 后).
      if (names.includes(char)) return new Set([root]);
      const owners = rootsOf(char);
      return owners.size > 0 ? owners : new Set([root]);
    };
    const belongsOnlyHere = (char: string): boolean => {
      const owners = ownersOf(char);
      return owners.size === 1 && owners.has(root);
    };
    const safeForms = [...new Set([...names, ...regional.flat()])].filter(
      belongsOnlyHere
    );
    const support = REGIONS.filter((_, region) =>
      safeForms.some((char) => tierOf(region, char) > 0)
    ).length;
    const reference =
      names.toSorted(
        (a, b) => listedRegions(b) - listedRegions(a) || cp(a) - cp(b)
      )[0] ?? root;
    // A group attested in exactly one region may not take forms other groups own.
    const allowed = perRegion((region) =>
      regional[region].filter((char) => belongsOnlyHere(char) || support !== 1)
    );
    /**
     * What each region writes: its own OpenCC answer when its own list enters it; otherwise a form of
     * the group its list does enter; otherwise a form its font can draw; otherwise the group's name.
     */
    const chars = perRegion((region) => {
      const produced = allowed[region];
      return (
        produced.find((char) => generates(region, char)) ??
        names.find((name) => generates(region, name)) ??
        safeForms.find((char) => generates(region, char)) ??
        produced.find((char) => sans[region]?.has(cp(char))) ??
        reference
      );
    });
    const accounted = perRegion(
      (region) =>
        new Set(
          [...new Set([...regional[region], ...safeForms])].filter(
            (char) => belongsOnlyHere(char) && tierOf(region, char) > 0
          )
        )
    );
    folded.push({
      key: chooseKey(names, chars, [...new Set(chars)].filter(belongsOnlyHere)),
      chars,
      accounted
    });
  }

  // A normalization target no region lists, and that shows no listed form, is not a group (戱 is
  // already represented by 戯 under 戲).
  let rows = folded.filter((row) =>
    row.chars.some((char, region) => tierOf(region, char) > 0)
  );

  /** A region's list entry for a form: Hong Kong gives one index to a character and its variant code points. */
  const entryOf = (region: number, char: string): string =>
    (region === 1 ? lists.hkIndex.get(char) : undefined) ?? char;
  /** The entries a group shows (its listed columns) and the ones it accounts for besides, per region. */
  const entries = (row: Folded): Tuple<{ shown?: string; held: Set<string> }> =>
    perRegion((region) => {
      const char = row.chars[region];
      const shown =
        tierOf(region, char) > 0 ? entryOf(region, char) : undefined;
      const held = new Set(
        [...row.accounted[region]].map((form) => entryOf(region, form))
      );
      if (shown !== undefined) held.add(shown);
      return { ...(shown === undefined ? {} : { shown }), held };
    });
  /** A list enters the character as an entry of its own, not as one code point of a shared entry. */
  const ownEntry = (char: string): boolean =>
    REGIONS.some(
      (_, region) =>
        tierOf(region, char) > 0 && (region !== 1 || hkSoleEntry(char))
    );

  /**
   * A group named by a character no list enters as its own entry, and whose every listed form
   * another group already shows in the same region, adds nothing. These are one character under two
   * orthodox names that no region lists side by side: 鷄 and 雞 (Japan's 鶏 names both), 竝 and 並,
   * and Hong Kong's variant code points of one entry (擧 beside 舉). hanji joins most such pairs with
   * a table from Korea's list, which we leave out (spec 22, decision 3). Two kinds of group stay even
   * when other groups show all their forms: one named by a listed character (吃 is a character of its
   * own, not only how China writes 喫), and one whose only listed form is China's (并 stands for 並,
   * 併 and 幷, three characters merged by simplification, as 发 is for 發 and 髮). Weaker groups go
   * first, so of two that show the same entries one stays.
   */
  const shownBy = REGIONS.map(() => new Map<string, number>());
  const heldBy = REGIONS.map(() => new Map<string, number>());
  const rowEntries = new Map(rows.map((row) => [row, entries(row)]));
  const tally = (row: Folded, by: number): void => {
    for (const [region, { shown, held }] of (
      rowEntries.get(row) ?? []
    ).entries()) {
      if (shown !== undefined) count(shownBy[region], shown, by);
      for (const entry of held) count(heldBy[region], entry, by);
    }
  };
  for (const row of rows) tally(row, 1);
  const listedColumns = (row: Folded): number =>
    (rowEntries.get(row) ?? []).filter(({ shown }) => shown !== undefined)
      .length;
  const dropped = new Set<Folded>();
  for (const row of rows.toSorted(
    (a, b) =>
      listedColumns(a) - listedColumns(b) ||
      generatingRegions(a.key) - generatingRegions(b.key)
  )) {
    const own = rowEntries.get(row) ?? [];
    if (
      ownEntry(row.key) ||
      own.every(({ shown }, region) => shown === undefined || region === CN)
    )
      continue;
    const redundant = own.every(
      ({ shown, held }, region) =>
        (shown === undefined || (shownBy[region]?.get(shown) ?? 0) > 1) &&
        [...held].every((entry) => (heldBy[region]?.get(entry) ?? 0) > 1)
    );
    if (redundant) {
      tally(row, -1);
      dropped.add(row);
    }
  }
  rows = rows.filter((row) => !dropped.has(row));

  // Every listed entry must be shown or accounted for; one normalization still missed becomes its
  // own group rather than disappearing (a few mainland entries map to a target the reverse table lacks).
  const accountedEntries = REGIONS.map(() => new Set<string>());
  for (const row of rows)
    for (const [region, { held }] of entries(row).entries())
      for (const entry of held) accountedEntries[region]?.add(entry);
  const accountsFor = (region: number, char: string): boolean =>
    accountedEntries[region]?.has(entryOf(region, char)) ?? false;
  const extra: Folded[] = [];
  for (const [region, map] of listMaps.entries())
    for (const char of map.keys())
      if (generates(region, char) && !accountsFor(region, char))
        extra.push({
          key: char,
          chars: [char, char, char, char],
          accounted: [new Set(), new Set(), new Set(), new Set()]
        });
  rows = [...rows, ...extra];

  // Substituting a form can leave two groups with the same four columns: one group, one row.
  const merged = new Map<string, Folded>();
  for (const row of rows) {
    const columns = row.chars.join("");
    const held = merged.get(columns);
    if (!held) merged.set(columns, row);
    else
      merged.set(columns, {
        ...held,
        key: chooseKey([held.key, row.key], held.chars)
      });
  }

  const groupKeys = new Set([...merged.values()].map((row) => row.key));
  return [...merged.values()].map((row): RegionalGroup => {
    const points = row.chars.map(cp);
    const sansCids = points.map((point, region) => sans[region]?.get(point));
    const serifCids = points.map((point, region) => serif[region]?.get(point));
    // Japan's pre-reform form must be an explicit shinjitai pair; a different key alone proves nothing.
    // The key when it pairs with Japan's form; else the one orthodox form the table gives Japan's form,
    // when that form names no group of its own (餅 → 餠, once the group named 餠 has gone as a
    // duplicate). 予 → 豫 is no reform of the character 予: 豫 has its own group, showing Japan's 予.
    const orthodox = opencc.jpShinjitai.get(row.chars[JP]) ?? [];
    const old = standardToJp.get(row.key)?.includes(row.chars[JP])
      ? row.key
      : orthodox.length === 1 &&
          orthodox[0] !== row.chars[JP] &&
          !groupKeys.has(orthodox[0])
        ? orthodox[0]
        : undefined;
    const oldPoint = old === undefined ? undefined : cp(old);
    const glyphSig = unifiedSignature(
      old === undefined ? sansCids : [...sansCids, sans[JP].get(oldPoint!)],
      old === undefined ? serifCids : [...serifCids, serif[JP].get(oldPoint!)],
      old === undefined ? points : [...points, oldPoint]
    );
    return {
      key: row.key,
      chars: row.chars,
      ...(old === undefined ? {} : { old }),
      glyphSig,
      cpSig: partitionSignature(points),
      tiers: perRegion((region) => tierOf(region, row.chars[region]))
    };
  });
};

// ── Stroke counts ─────────────────────────────────────────────────────────────────────────────────

/** IRG source letter per region (https://www.unicode.org/irg/prefixes.html). */
const IRG_SOURCE: Tuple<string> = ["G", "H", "T", "J"];

export interface StrokeSources {
  unihan: Map<string, UnihanEntry>;
  /** Taiwan's official counts (CNS 11643). */
  taiwan: Map<string, number>;
  /** Japan's counts (Kanjidic2, already in the dictionary). */
  japan: Map<string, number>;
}

/** Unihan's count for a region's form: the per-source alternate, Adobe's Japanese count, or the total. */
const unihanStrokes = (
  unihan: Map<string, UnihanEntry>,
  char: string,
  region: number
): number | undefined => {
  const entry = unihan.get(char);
  const alternate = entry?.altStrokes?.[IRG_SOURCE[region] ?? ""];
  if (alternate) return alternate;
  if (region === JP && entry?.adobeStrokes) return entry.adobeStrokes;
  const values = entry?.strokes;
  if (!values?.length) return undefined;
  // kTotalStrokes's second value, when there is one, is the zh-Hant count.
  return region === CN ? values[0] : (values[1] ?? values[0]);
};

/**
 * Each region's stroke count, plus the old form's. Taiwan's comes from Taiwan's own data first: it
 * disagrees with Unihan's single count for 15% of Taiwan's forms, by regional convention (返 is 8
 * strokes there, 7 in China and Japan). Japan's comes from Kanjidic2. Hong Kong has no official
 * source here, so it takes the count of a region that writes the same glyph and code point.
 */
/**
 * Each region's reading of its own form (spec 22, phase 5): Mandarin for China and Taiwan, Cantonese
 * (Jyutping) for Hong Kong, and null for Japan, whose readings are the kanji page's own
 * (`kanji_characters`). China's lists every reading its 2013 standard gives a polyphone, the most
 * frequent first (行: xíng, háng, héng), since kTGHZ2013 sorts them alphabetically. Taiwan's is
 * Unihan's Taiwan value where it differs from China's (UAX #38, kMandarin).
 */
export const regionalReadings = (
  group: RegionalGroup,
  unihan: Map<string, UnihanEntry>
): Tuple<string | null> => {
  const list = (values: readonly string[] | undefined): string | null =>
    values === undefined || values.length === 0 ? null : values.join(", ");
  const china = unihan.get(group.chars[CN]);
  const chinaReadings =
    china?.mandarin === undefined
      ? china?.mandarinStandard
      : [
          ...new Set([
            ...china.mandarin.slice(0, 1),
            ...(china.mandarinStandard ?? [])
          ])
        ];
  const taiwan = unihan.get(group.chars[2])?.mandarin;
  return [
    list(chinaReadings),
    list(unihan.get(group.chars[1])?.cantonese),
    // The last value: Taiwan's when there are two, the only one otherwise.
    list(taiwan?.slice(-1)),
    null
  ];
};

export const strokeCounts = (
  group: RegionalGroup,
  sources: StrokeSources
): { strokes: Tuple<number | undefined>; old?: number } => {
  const own = perRegion((region): number | undefined => {
    const char = group.chars[region];
    if (region === 2)
      return (
        sources.taiwan.get(char) ?? unihanStrokes(sources.unihan, char, region)
      );
    if (region === JP)
      return (
        sources.japan.get(char) ?? unihanStrokes(sources.unihan, char, region)
      );
    return unihanStrokes(sources.unihan, char, region);
  });
  // Hong Kong (index 1) borrows from Taiwan, then China, then Japan, when it writes the same glyph.
  const hkGlyph = group.glyphSig[1];
  for (const lender of [2, 0, 3])
    if (
      group.glyphSig[lender] === hkGlyph &&
      group.cpSig[lender] === group.cpSig[1] &&
      own[lender] !== undefined
    ) {
      own[1] = own[lender];
      break;
    }
  const old =
    group.old === undefined
      ? undefined
      : (sources.japan.get(group.old) ??
        unihanStrokes(sources.unihan, group.old, JP));
  return { strokes: own, ...(old === undefined ? {} : { old }) };
};

// ── Lists ─────────────────────────────────────────────────────────────────────────────────────────

/** China's 2013 table has 8,105 characters in three levels, by index: 1–3,500, 3,501–6,500, the rest. */
export const tghLevel = (tgh: string | undefined): number => {
  const index = Number(tgh?.split(":")[1]);
  if (!Number.isFinite(index) || index < 1) return 0;
  return index <= 3500 ? 1 : index <= 6500 ? 2 : 3;
};

/**
 * Each region's list. Japan's kyōiku kanji (tier 2) are the jōyō kanji Kanjidic2 grades 1–6.
 * kJoyoKanji also marks variants of a jōyō kanji with a code point: only "2010" is the list itself.
 */
export const regionalLists = (
  unihan: Map<string, UnihanEntry>,
  taiwanTiers: Map<string, number>,
  kanjiGrades: Map<string, number>
): RegionalLists => {
  const cn = new Map<string, number>();
  const hk = new Map<string, number>();
  const hkIndex = new Map<string, string>();
  const jp = new Map<string, number>();
  for (const [char, entry] of unihan) {
    const level = tghLevel(entry.tgh);
    if (level) cn.set(char, level);
    if (entry.hkGlyph !== undefined) {
      hk.set(char, 1);
      hkIndex.set(char, entry.hkGlyph);
    }
    if (entry.joyo === "2010") {
      const grade = kanjiGrades.get(char) ?? 0;
      jp.set(char, grade >= 1 && grade <= 6 ? 2 : 1);
    }
  }
  return { cn, hk, tw: taiwanTiers, jp, hkIndex };
};

// ── Fetching ──────────────────────────────────────────────────────────────────────────────────────

export interface RegionalSources {
  opencc: OpenccTables;
  sans: Tuple<Map<number, number>>;
  serif: Tuple<Map<number, number>>;
  unihan: Map<string, UnihanEntry>;
  taiwan: {
    tiers: Map<string, number>;
    strokes: Map<string, number>;
    /** The CNS 11643 archives' Last-Modified dates, for the build's provenance. */
    propertiesDate: string;
    mappingsDate: string;
  };
}

type Fetch = (url: string) => Promise<Response>;

const text = async (fetch: Fetch, url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.text();
};

const zip = async (
  fetch: Fetch,
  url: string
): Promise<{ files: Record<string, Uint8Array>; lastModified: string }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return {
    files: unzipSync(new Uint8Array(await res.arrayBuffer())),
    lastModified: res.headers.get("last-modified") ?? ""
  };
};

/** Download and parse every source. `fetch` is the build's retrying fetch. */
export const fetchRegionalSources = async (
  fetch: Fetch
): Promise<RegionalSources> => {
  const cmap = async (
    family: "Sans" | "Serif",
    region: number
  ): Promise<Map<number, number>> =>
    parseCMap(
      await text(
        fetch,
        `https://raw.githubusercontent.com/adobe-fonts/source-han-${family.toLowerCase()}/${family === "Sans" ? SOURCE_HAN_SANS_SHA : SOURCE_HAN_SERIF_SHA}/UniSourceHan${family}${CMAP_REGION[region]}-UTF32-H`
      )
    );
  const dict = async (name: string): Promise<Map<string, string[]>> =>
    parseOpenccDict(await text(fetch, `${OPENCC_BASE}/${name}.txt`));
  const [st, ts, tw, hk, jpShinjitai, sans, serif, unihanZip, props, maps] =
    await Promise.all([
      dict("STCharacters"),
      dict("TSCharacters"),
      dict("TWVariants"),
      dict("HKVariants"),
      dict("JPShinjitaiCharacters"),
      Promise.all(perRegion(async (region) => cmap("Sans", region))),
      Promise.all(perRegion(async (region) => cmap("Serif", region))),
      zip(fetch, UNIHAN_URL),
      zip(fetch, CNS_PROPERTIES_URL),
      zip(fetch, CNS_MAPPINGS_URL)
    ]);
  const decoder = new TextDecoder();
  const unihan = parseUnihan(
    Object.entries(unihanZip.files)
      .filter(([name]) => name.endsWith(".txt"))
      .map(([, bytes]) => decoder.decode(bytes))
  );
  const fileNamed = (
    files: Record<string, Uint8Array>,
    name: string
  ): string => {
    const found = Object.entries(files).find(([path]) => path.endsWith(name));
    if (!found) throw new Error(`CNS 11643 archive has no ${name}`);
    return decoder.decode(found[1]);
  };
  const toChar = parseCnsUnicode(
    Object.entries(maps.files)
      .filter(([path]) => /CNS2UNICODE_Unicode [^/]*\.txt$/.test(path))
      .map(([, bytes]) => decoder.decode(bytes))
  );
  const taiwan = parseCnsTaiwan(
    fileNamed(props.files, "CNS_source.txt"),
    fileNamed(props.files, "CNS_stroke.txt"),
    toChar
  );
  // A changed source name or file layout upstream would quietly shrink Taiwan's list and reshape
  // every group that depends on it, so a list off its official size fails the build instead.
  const common = [...taiwan.tiers.values()].filter((tier) => tier === 1).length;
  if (common !== TW_COMMON_SIZE)
    throw new Error(
      `CNS 11643 gives Taiwan's common list ${common} characters, not its official ${TW_COMMON_SIZE}. ` +
        `Check ${CNS_PROPERTIES_URL} (CNS_source.txt) for a renamed source, and TW_COMMON in scripts/regional.ts.`
    );
  return {
    opencc: { st, ts, tw, hk, jpShinjitai },
    sans,
    serif,
    unihan,
    taiwan: {
      ...taiwan,
      propertiesDate: props.lastModified,
      mappingsDate: maps.lastModified
    }
  };
};
