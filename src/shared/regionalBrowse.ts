import { toHiragana } from "wanakana";
import type { RegionalGroupDto } from "./messages";

/**
 * The Kanji tab's "Regional differences" list (spec 22, phase 7): hanji's list filters, adapted to
 * the sidebar. One region is chosen for both the stroke range and the sort, where hanji has a
 * chooser for each.
 */

/** The four regions, in the order of a group's columns. */
export const REGION_NAMES = ["China", "Hong Kong", "Taiwan", "Japan"] as const;
export type RegionIndex = 0 | 1 | 2 | 3;

const joinNames = (names: readonly string[]): string =>
  new Intl.ListFormat("en-GB", { type: "conjunction" }).format(names);

/**
 * The thirteen ways four regions can split into two or three forms, as glyph signatures over
 * (China, Hong Kong, Taiwan, Japan). Japan alone first: this is a Japanese dictionary.
 */
export const SPLITS = [
  "0001",
  "0111",
  "0100",
  "0010",
  "0011",
  "0101",
  "0110",
  "0012",
  "0102",
  "0120",
  "0112",
  "0121",
  "0122"
] as const;

/**
 * A split in words: "Japan alone differs", "China and Japan versus Hong Kong and Taiwan", "Only
 * China and Hong Kong agree".
 */
export const splitLabel = (signature: string): string => {
  const blocks = new Map<string, string[]>();
  for (const [region, digit] of Array.from(signature.slice(0, 4)).entries()) {
    const names = blocks.get(digit) ?? [];
    names.push(REGION_NAMES[region] ?? "");
    blocks.set(digit, names);
  }
  const sets = [...blocks.values()];
  if (sets.length === 2) {
    const alone = sets.find((names) => names.length === 1);
    if (alone !== undefined) return `${joinNames(alone)} alone differs`;
    return sets.map(joinNames).join(" versus ");
  }
  const pair = sets.find((names) => names.length === 2) ?? [];
  return `Only ${joinNames(pair)} agree`;
};

/** The patterns by number of forms; two and three forms each open their exact splits. */
export const FORM_COUNTS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "any", label: "Any" },
  { id: "1", label: "Same everywhere" },
  { id: "2", label: "Two forms" },
  { id: "3", label: "Three forms" },
  { id: "4", label: "Four forms" }
];

/** Every difference pattern: a number of forms, or one exact split. */
export const PATTERNS: ReadonlyArray<{ id: string; label: string }> = [
  ...FORM_COUNTS,
  ...SPLITS.map((signature) => ({
    id: signature,
    label: splitLabel(signature)
  }))
];

/** The official lists a group can be on, by the regions' list levels (`tiers`). */
export const LISTS = [
  {
    id: "cn1",
    label: "China, level 1",
    has: (g: RegionalGroupDto): boolean => g.tiers[0] === 1
  },
  {
    id: "cn2",
    label: "China, level 2",
    has: (g: RegionalGroupDto): boolean => g.tiers[0] === 2
  },
  {
    id: "cn3",
    label: "China, level 3",
    has: (g: RegionalGroupDto): boolean => g.tiers[0] === 3
  },
  {
    id: "hk",
    label: "Hong Kong, common",
    has: (g: RegionalGroupDto): boolean => g.tiers[1] === 1
  },
  {
    id: "tw1",
    label: "Taiwan, common",
    has: (g: RegionalGroupDto): boolean => g.tiers[2] === 1
  },
  {
    id: "tw2",
    label: "Taiwan, less common",
    has: (g: RegionalGroupDto): boolean => g.tiers[2] === 2
  },
  // Japan's level 2 (kyōiku) is a part of level 1 (jōyō), so jōyō takes both.
  {
    id: "joyo",
    label: "Jōyō kanji",
    has: (g: RegionalGroupDto): boolean => (g.tiers[3] ?? 0) >= 1
  },
  {
    id: "kyoiku",
    label: "Kyōiku kanji",
    has: (g: RegionalGroupDto): boolean => g.tiers[3] === 2
  },
  {
    id: "old",
    label: "Japan's old forms",
    has: (g: RegionalGroupDto): boolean => g.old !== undefined
  }
] as const;
export type ListId = (typeof LISTS)[number]["id"];

export type RegionalSort = "frequency" | "strokes" | "codePoint";

export interface RegionalFilters {
  /** A character, a reading (pinyin, Jyutping, kana or romaji) or a code point (`U+5B66`). */
  search: string;
  /** An id from `PATTERNS`. */
  pattern: string;
  /** Lists the group must be on at least one of; none selected filters nothing. */
  lists: readonly ListId[];
  /** The region whose stroke counts, frequency and code points the range and the sort read. */
  region: RegionIndex;
  /** The stroke range in that region, or null for any count. */
  strokes: readonly [number, number] | null;
  sort: RegionalSort;
}

export const DEFAULT_FILTERS: RegionalFilters = {
  search: "",
  pattern: "any",
  lists: [],
  region: 3,
  strokes: null,
  sort: "frequency"
};

/** Katakana (ァ to ヶ) sit 0x60 above their hiragana; combining marks 0x300 to 0x36f are Latin's tone marks. */
const KATAKANA = [0x30a1, 0x30f6] as const;
const KANA_OFFSET = 0x60;
const LATIN_MARKS = [0x300, 0x36f] as const;
const within = (cp: number, [low, high]: readonly [number, number]): boolean =>
  cp >= low && cp <= high;

/**
 * Readings compared loosely: case and tone marks (xué, xue), kana script (ガク, がく), and the kun
 * reading's okurigana dot and affix hyphen (まな.ぶ). Voicing marks stay, so がく does not find か.く.
 */
const fold = (text: string): string =>
  Array.from(text.toLowerCase().replace(/[.-]/gu, "").normalize("NFD"))
    .flatMap((char) => {
      const cp = char.codePointAt(0) ?? 0;
      if (within(cp, LATIN_MARKS)) return [];
      return [
        within(cp, KATAKANA) ? String.fromCodePoint(cp - KANA_OFFSET) : char
      ];
    })
    .join("");

const READING_SEPARATORS = /[,、\s]+/u;
const CODE_POINT = /^(?:u\+[0-9a-f]{4,5}|(?=[a-f]*\d)[0-9a-f]{4,5})$/iu;
const HAN = /\p{Script=Han}/gu;

const formsOf = (group: RegionalGroupDto): string[] =>
  group.old === undefined ? group.chars : [...group.chars, group.old];

const codePoint = (char: string | undefined): number =>
  char?.codePointAt(0) ?? Number.MAX_SAFE_INTEGER;

/** Each group's readings, folded once and kept while the list is open: folding is most of a search. */
const folded = new WeakMap<RegionalGroupDto, string[][]>();
const foldedReadings = (group: RegionalGroupDto): string[][] => {
  let readings = folded.get(group);
  if (readings === undefined) {
    readings = group.readings.map((value) =>
      value === null ? [] : value.split(READING_SEPARATORS).map(fold)
    );
    folded.set(group, readings);
  }
  return readings;
};

/** A test for the search, worked out once: by a form the group writes, a code point, or a reading. */
const searchFor = (query: string): ((group: RegionalGroupDto) => boolean) => {
  const han = query.match(HAN);
  if (han !== null)
    return (group) => formsOf(group).some((form) => han.includes(form));
  if (CODE_POINT.test(query)) {
    const wanted = Number.parseInt(query.replace(/^u\+/iu, ""), 16);
    return (group) => formsOf(group).some((form) => codePoint(form) === wanted);
  }
  // Japanese readings are in kana, so romaji is read as kana for them ("gaku" finds ガク); the
  // Chinese readings are already romanized. The dot and hyphen go before wanakana, which would read
  // them as "。" and a long-vowel mark.
  const latin = fold(query);
  const kana = fold(toHiragana(query.toLowerCase().replace(/[.-]/gu, "")));
  return (group) =>
    foldedReadings(group).some((readings, region) =>
      readings.some((reading) =>
        reading.startsWith(region === 3 ? kana : latin)
      )
    );
};

/** Missing values (a form no corpus ranks, a count no source gives) sort last. */
const ascending = (a: number | null, b: number | null): number =>
  (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);

/**
 * The groups that pass every filter, sorted by the chosen region's frequency, stroke count or code
 * point, then by that region's code point, so equal values keep one order.
 */
export const filterRegional = (
  groups: readonly RegionalGroupDto[],
  filters: RegionalFilters
): RegionalGroupDto[] => {
  const query = filters.search.trim();
  const matches = query === "" ? undefined : searchFor(query);
  const lists = LISTS.filter((list) => filters.lists.includes(list.id));
  const { region, strokes, pattern } = filters;
  const value = (group: RegionalGroupDto): number | null =>
    filters.sort === "frequency"
      ? (group.ranks[region] ?? null)
      : filters.sort === "strokes"
        ? (group.strokes[region] ?? null)
        : codePoint(group.chars[region]);
  return groups
    .filter((group) => {
      const signature = group.glyphSig.slice(0, 4);
      if (pattern !== "any") {
        const forms = String(new Set(signature).size);
        if (pattern.length === 1 ? forms !== pattern : signature !== pattern)
          return false;
      }
      if (lists.length > 0 && !lists.some((list) => list.has(group)))
        return false;
      if (strokes !== null) {
        const count = group.strokes[region] ?? null;
        if (count === null || count < strokes[0] || count > strokes[1])
          return false;
      }
      return matches === undefined || matches(group);
    })
    .toSorted(
      (a, b) =>
        ascending(value(a), value(b)) ||
        codePoint(a.chars[region]) - codePoint(b.chars[region]) ||
        a.key.localeCompare(b.key)
    );
};
