import type { RegionalGroupDto } from "../shared/messages";
import {
  OLD_COLUMN,
  REGIONAL_FONT_FAMILIES,
  fontRegionOf
} from "../shared/regionalFonts";

/**
 * What the regional-forms views show (spec 22), worked out from a group as the build stored it:
 * the distinct forms, who writes each, and how to say so in a line.
 */

/** Column names: the four regions, then Japan's old form. */
export const COLUMN_NAMES = [
  "China",
  "Hong Kong",
  "Taiwan",
  "Japan",
  "Japan's old form"
] as const;
/**
 * Each column's language tag. It picks the fallback font for a form the region fonts cannot draw,
 * which must still be that region's shape, and how a screen reader pronounces the character.
 */
export const COLUMN_LANGS = ["zh-CN", "zh-HK", "zh-TW", "ja", "ja"] as const;
const JAPAN = 3;

/** The ink of the `index`-th distinct form (`--jisho-ink-*`, theme.css): the overprint layer and its chart row match. */
export const inkOf = (index: number): string => `var(--jisho-ink-${index % 5})`;

/** One distinct form: a glyph and a code point, and every column that writes it so. */
export interface FormRow {
  char: string;
  /** The columns (0–3 regions, 4 the old form) that write this form. */
  columns: number[];
  /** The family that draws it: the font of its first column (see `fontRegionOf`). */
  family: string;
  /** `U+5B66`. */
  codePoint: string;
  /** Its stroke counts, once each: two only where two regions count the same glyph differently. */
  strokes: number[];
  /** Its places on the regions' lists, in region order ("Level 1 in China", "Kyōiku kanji"). */
  lists: string[];
  /** Another row has the same code point, drawn differently (返): the case code points cannot show. */
  sharesCodePoint: boolean;
}

/** Each region's list levels by name; a level not here (0, unlisted) has none. */
const LIST_NAMES: Partial<Record<number, Partial<Record<number, string>>>> = {
  0: { 1: "Level 1 in China", 2: "Level 2 in China", 3: "Level 3 in China" },
  1: { 1: "Common in Hong Kong" },
  2: { 1: "Common in Taiwan", 2: "Less common in Taiwan" },
  3: { 1: "Jōyō kanji", 2: "Kyōiku kanji" }
};

/** `U+5B66` for 学. */
export const codePointOf = (char: string): string =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

const columnsOf = (group: RegionalGroupDto): number[] =>
  group.old === undefined ? [0, 1, 2, 3] : [0, 1, 2, 3, OLD_COLUMN];

const charOf = (group: RegionalGroupDto, column: number): string =>
  (column === OLD_COLUMN ? group.old : group.chars[column]) ?? "";

/**
 * The group's distinct forms, Japan's first, then in the order a region first writes them. Two
 * columns share a form when they share both the glyph and the code point.
 */
export const formRows = (group: RegionalGroupDto): FormRow[] => {
  const rows: FormRow[] = [];
  const ordered = [JAPAN, ...columnsOf(group).filter((c) => c !== JAPAN)];
  for (const column of ordered) {
    const char = charOf(group, column);
    const glyph = group.glyphSig[column];
    const held = rows.find(
      (row) =>
        row.char === char && group.glyphSig[row.columns[0] ?? 0] === glyph
    );
    const strokes = group.strokes[column] ?? null;
    if (held) {
      held.columns.push(column);
      if (strokes !== null && !held.strokes.includes(strokes))
        held.strokes.push(strokes);
      continue;
    }
    rows.push({
      char,
      columns: [column],
      family: REGIONAL_FONT_FAMILIES[fontRegionOf(group, column)] ?? "",
      codePoint: codePointOf(char),
      strokes: strokes === null ? [] : [strokes],
      lists: [],
      sharesCodePoint: false
    });
  }
  for (const row of rows) {
    row.columns.sort((a, b) => a - b);
    // The old form is on no list; the regions' lists follow their column order.
    row.lists = row.columns.flatMap((column) => {
      const name = LIST_NAMES[column]?.[group.tiers[column] ?? 0];
      return name === undefined ? [] : [name];
    });
    row.sharesCodePoint = rows.some(
      (other) => other !== row && other.codePoint === row.codePoint
    );
  }
  return rows;
};

const strokesWord = (count: number): string =>
  `${count} ${count === 1 ? "stroke" : "strokes"}`;

/**
 * "8 strokes"; or, where two regions count one glyph differently, "8 strokes in China, 9 in Japan".
 * Empty when no source counts the form.
 */
export const strokeText = (group: RegionalGroupDto, row: FormRow): string => {
  if (row.strokes.length === 0) return "";
  if (row.strokes.length === 1) return strokesWord(row.strokes[0]);
  return row.columns
    .flatMap((column) => {
      const count = group.strokes[column] ?? null;
      return count === null ? [] : [[count, COLUMN_NAMES[column]] as const];
    })
    .map(([count, place], index) =>
      index === 0 ? `${strokesWord(count)} in ${place}` : `${count} in ${place}`
    )
    .join(", ");
};

/** "China, Hong Kong and Taiwan". */
export const joinNames = (names: readonly string[]): string =>
  new Intl.ListFormat("en-GB", { type: "conjunction" }).format(names);

/** The regions a row's columns name, with the old form last. */
export const columnNames = (columns: readonly number[]): string =>
  joinNames(columns.map((column) => COLUMN_NAMES[column] ?? ""));

/**
 * The kanji page's line for a group: whom Japan's form differs from, and how many forms there are.
 * The old form is not a region, so it is named but does not count as a region writing it otherwise.
 */
export const summaryLine = (group: RegionalGroupDto): string => {
  const regionalGlyphs = new Set(group.glyphSig.slice(0, 4));
  const japan = group.glyphSig[JAPAN];
  const others = [0, 1, 2].filter((region) => group.glyphSig[region] !== japan);
  const old = group.old === undefined ? "" : ` · old form ${group.old}`;
  if (others.length === 0)
    return `Written the same way in China, Hong Kong, Taiwan and Japan${old}`;
  return `Written differently in ${joinNames(
    others.map((region) => COLUMN_NAMES[region] ?? "")
  )} · ${regionalGlyphs.size} forms${old}`;
};
