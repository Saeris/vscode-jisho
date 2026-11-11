import type { RegionalDrawingDto, RegionalGroupDto } from "../shared/messages";

/**
 * Stroke order by region (spec 22, phase 4): which drawing shows each of a group's forms.
 *
 * Japan's drawings are `assets/kanji-svgs`; China's and Taiwan's come from AnimCJK's Simplified and
 * Traditional Chinese sets, as `assets/regional-strokes.json` records (scripts/build-regional-
 * strokes.ts). Hong Kong has no set of its own and borrows the drawing of a region that writes the
 * same glyph at the same code point; Japan's old form borrows the same way, or has Japan's drawing
 * of the old character. A form that nothing draws stays without a drawing: showing another region's
 * order in its place would hide exactly the difference the reader is checking.
 */

/** Which set draws a form: Japan's, or AnimCJK's Simplified or Traditional Chinese. */
export type DrawingSet = "ja" | "hans" | "hant";

/** China's and Taiwan's forms, and the set that draws each (`assets/regional-strokes.json`). */
export interface StrokeManifest {
  cn: Partial<Record<string, DrawingSet>>;
  tw: Partial<Record<string, DrawingSet>>;
}

/** One drawing: a set and the character it draws. */
export interface Drawing {
  set: DrawingSet;
  char: string;
}

const CN = 0;
const HK = 1;
const TW = 2;
const JP = 3;
const OLD = 4;

const charOf = (group: RegionalGroupDto, column: number): string =>
  (column === OLD ? group.old : group.chars[column]) ?? "";

/**
 * The group's distinct drawings, each with the columns it shows, Japan's first. Columns without a
 * drawing are listed too, one entry per form, with `svg: null`.
 *
 * `read` loads a drawing, or returns null when its file is missing; a missing file makes the form
 * undrawn rather than borrowed, for the same reason as above.
 */
export const regionalDrawings = async (
  group: RegionalGroupDto,
  manifest: StrokeManifest,
  read: (drawing: Drawing) => Promise<string | null>
): Promise<RegionalDrawingDto[]> => {
  const loaded = new Map<string, Promise<string | null>>();
  const load = async (drawing: Drawing | null): Promise<Drawing | null> => {
    if (drawing === null) return null;
    const key = `${drawing.set}:${drawing.char}`;
    let svg = loaded.get(key);
    if (svg === undefined) loaded.set(key, (svg = read(drawing)));
    return (await svg) === null ? null : drawing;
  };
  const listed = (region: "cn" | "tw", char: string): Drawing | null => {
    const set = manifest[region][char];
    return set === undefined ? null : { set, char };
  };
  const sameForm = (a: number, b: number): boolean =>
    group.glyphSig[a] === group.glyphSig[b] &&
    group.cpSig[a] === group.cpSig[b];

  const drawn: Array<Drawing | null> = [null, null, null, null, null];
  drawn[JP] = await load({ set: "ja", char: charOf(group, JP) });
  drawn[CN] = await load(listed("cn", charOf(group, CN)));
  drawn[TW] = await load(listed("tw", charOf(group, TW)));
  // Hong Kong's standard is closest to Taiwan's, then China's.
  for (const lender of [TW, CN, JP])
    if (drawn[HK] === null && sameForm(HK, lender))
      drawn[HK] = drawn[lender] ?? null;
  if (group.old !== undefined) {
    for (const lender of [HK, TW, CN, JP])
      if (
        drawn[OLD] === null &&
        group.chars[lender] === group.old &&
        group.glyphSig[lender] === group.glyphSig[OLD]
      )
        drawn[OLD] = drawn[lender] ?? null;
    drawn[OLD] ??= await load({ set: "ja", char: group.old });
  }

  const columns =
    group.old === undefined ? [JP, CN, HK, TW] : [JP, CN, HK, TW, OLD];
  const options = new Map<string, RegionalDrawingDto>();
  for (const column of columns) {
    const drawing = drawn[column] ?? null;
    const key =
      drawing === null
        ? `none:${charOf(group, column)}`
        : `${drawing.set}:${drawing.char}`;
    const option = options.get(key);
    if (option) {
      option.columns.push(column);
      continue;
    }
    options.set(key, {
      columns: [column],
      char: drawing?.char ?? charOf(group, column),
      svg:
        drawing === null
          ? null
          : await (loaded.get(key) ?? Promise.resolve(null))
    });
  }
  for (const option of options.values()) option.columns.sort((a, b) => a - b);
  return [...options.values()];
};
