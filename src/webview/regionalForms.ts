import type {
  ChineseSense,
  NoteBlock,
  RegionalGroupDto,
  RegionalNoteDto
} from "../shared/messages";
import {
  OLD_COLUMN,
  REGIONAL_FONT_FAMILIES,
  fontRegionOf
} from "../shared/regionalFonts";
import { REGION_NAMES } from "../shared/regionalBrowse";

/**
 * What the regional-forms views show (spec 22), worked out from a group as the build stored it:
 * the distinct forms, who writes each, and how to say so in a line.
 */

/** Column names: the four regions, then Japan's old form. */
export const COLUMN_NAMES = [...REGION_NAMES, "Japan's old form"] as const;
/**
 * Each column's language tag. It picks the fallback font for a form the region fonts cannot draw,
 * which must still be that region's shape, and how a screen reader pronounces the character.
 */
export const COLUMN_LANGS = ["zh-CN", "zh-HK", "zh-TW", "ja", "ja"] as const;
/** Each column's short name, where a list row has no room for the full one. */
export const COLUMN_CODES = ["CN", "HK", "TW", "JP", "old"] as const;
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

/** How each region's reading is written. */
const READINGS = [
  { name: "Mandarin", lang: "zh-Latn-pinyin" },
  { name: "Cantonese", lang: "yue-Latn-jyutping" },
  { name: "Mandarin", lang: "zh-Latn-pinyin" },
  { name: "Japanese", lang: "ja" }
] as const;

/** Each region's corpus, as its rank's label: four corpora, so a rank never stands bare. */
const CORPORA = [
  "in modern Chinese texts",
  "in Cantonese texts (words.hk)",
  "in news and social media (2023)",
  "on Japanese Wikipedia"
] as const;

/** One region's line: its form, how it reads it, and how common the form is in its corpus. */
export interface UsageRow {
  region: string;
  char: string;
  lang: string;
  reading: string | null;
  readingName: string;
  readingLang: string;
  /** "#66 in modern Chinese texts", or "Not ranked in …". */
  rank: string;
}

/** The order of "Readings and frequency": Japan's first, as in the chart, since this is a Japanese dictionary. */
const USAGE_ORDER = [JAPAN, 0, 1, 2] as const;

/** The four regions' lines for "Readings and frequency" (spec 22, phase 5). */
export const usageRows = (group: RegionalGroupDto): UsageRow[] =>
  USAGE_ORDER.map((region) => {
    const reading = READINGS[region];
    const rank = group.ranks[region] ?? null;
    return {
      region: COLUMN_NAMES[region] ?? "",
      char: group.chars[region] ?? "",
      lang: COLUMN_LANGS[region] ?? "ja",
      reading: group.readings[region] ?? null,
      readingName: reading.name,
      readingLang: reading.lang,
      rank:
        rank === null
          ? `Not ranked ${CORPORA[region] ?? ""}`
          : `#${rank.toLocaleString("en")} ${CORPORA[region] ?? ""}`
    };
  });

/** One Wiktionary note as the view shows it (spec 22, phase 6). */
export interface NoteRow {
  char: string;
  /** The language and family of the form's first column, so the character keeps its region's shape. */
  lang: string;
  family: string;
  section: RegionalNoteDto["section"];
  /** What shows: the note's first paragraph, which nearly always says how the character is formed. */
  lead: NoteBlock[];
  /** What folds under "More from Wiktionary": mostly the word's history, older forms and cognates. */
  more: NoteBlock[];
  /** The section of the character's page the note is from. */
  url: string;
}

/**
 * Where a note's lead ends: after its first paragraph (with a label, the paragraph it labels) and any
 * lists under it, so 商's six shapes stay with the sentence that introduces them. 83% of the Chinese
 * notes open with how the character is formed ("Phono-semantic compound", "Simplified from").
 */
export const leadLength = (blocks: readonly NoteBlock[]): number => {
  let end = blocks[0]?.kind === "label" ? 2 : 1;
  while (blocks[end]?.kind === "list") end++;
  return Math.min(end, blocks.length);
};

/**
 * The order of the notes' languages: how the forms relate across languages, then Japanese (this is
 * a Japanese dictionary, and Japan's form leads the chart too), then Chinese.
 */
export const NOTE_SECTIONS = ["Translingual", "Japanese", "Chinese"] as const;

/**
 * The group's Wiktionary notes by language (`NOTE_SECTIONS`), and within one in the chart's order
 * (Japan's form first). So 学 reads "Simplified from 學" first, then where Japanese がく came from,
 * then 學's account of its parts.
 */
export const noteRows = (group: RegionalGroupDto): NoteRow[] => {
  const rows = formRows(group);
  const position = (char: string): number =>
    rows.findIndex((row) => row.char === char);
  return group.notes
    .toSorted(
      (a, b) =>
        NOTE_SECTIONS.indexOf(a.section) - NOTE_SECTIONS.indexOf(b.section) ||
        position(a.char) - position(b.char)
    )
    .map((note) => {
      const row = rows.find((form) => form.char === note.char);
      const lead = leadLength(note.blocks);
      return {
        char: note.char,
        lang: COLUMN_LANGS[row?.columns[0] ?? JAPAN] ?? "ja",
        family: row?.family ?? "",
        section: note.section,
        lead: note.blocks.slice(0, lead),
        more: note.blocks.slice(lead),
        url: wiktionaryUrl(note.char, note.section)
      };
    });
};

const wiktionaryUrl = (char: string, section: string): string =>
  `https://en.wiktionary.org/wiki/${encodeURIComponent(char)}#${section}`;

/** The group's meanings in Chinese as the view shows them, from one form's page. */
export interface MeaningsRow {
  char: string;
  lang: string;
  family: string;
  senses: ChineseSense[];
  url: string;
}

/**
 * Whose page the meanings come from: Taiwan's form first, then Hong Kong's, China's, Japan's and the
 * old form. A traditional form's page holds the definitions (a simplified one's points at it), and a
 * form only Japan writes can have a Chinese page about Japan: 円's says "Japanese yen", where 圓's
 * says "circle; round".
 */
const MEANING_ORDER = [2, 1, 0, JAPAN, OLD_COLUMN] as const;

/** The group's meanings in Chinese, or null when no form's page defines it. */
export const meaningsOf = (group: RegionalGroupDto): MeaningsRow | null => {
  const rows = formRows(group);
  for (const column of MEANING_ORDER) {
    const char = charOf(group, column);
    const meanings = group.meanings.find((m) => m.char === char);
    if (meanings === undefined || meanings.senses.length === 0) continue;
    const row = rows.find((form) => form.char === char);
    return {
      char,
      lang: COLUMN_LANGS[row?.columns[0] ?? column] ?? "ja",
      family: row?.family ?? "",
      senses: meanings.senses,
      url: wiktionaryUrl(char, "Chinese")
    };
  }
  return null;
};

/** "China, Hong Kong and Taiwan". */
export const joinNames = (names: readonly string[]): string =>
  new Intl.ListFormat("en-GB", { type: "conjunction" }).format(names);

/**
 * "as China and Japan write it", "as Taiwan writes it", and for the old form "as Japan wrote it
 * before its reform", joined when a form is both.
 */
export const asWritten = (columns: readonly number[]): string => {
  const regions = columns.filter((column) => column !== OLD_COLUMN);
  const now =
    regions.length === 0
      ? ""
      : `as ${joinNames(regions.map((column) => COLUMN_NAMES[column] ?? ""))} ${regions.length === 1 ? "writes" : "write"} it`;
  const before = columns.includes(OLD_COLUMN)
    ? "as Japan wrote it before its reform"
    : "";
  return [now, before].filter(Boolean).join(", and ");
};

/** The regions a row's columns name, with the old form last. */
export const columnNames = (columns: readonly number[]): string =>
  joinNames(columns.map((column) => COLUMN_NAMES[column] ?? ""));
