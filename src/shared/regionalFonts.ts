/**
 * The display fonts for regional forms (spec 22, phase 2): Noto Sans CJK in each region's version,
 * subset to the forms in the regional tables and renamed, because a modified subset should not
 * present itself as Noto. Built by scripts/build-regional-fonts.ts; the build and the webview both
 * read this module, so the font a form was subset into is the font that draws it.
 */

/** One family per region, in the order of the regional tables: China, Hong Kong, Taiwan, Japan. */
export const REGIONAL_FONT_FAMILIES = [
  "Jisho Sans SC",
  "Jisho Sans HK",
  "Jisho Sans TC",
  "Jisho Sans JP"
] as const;

/** Japan's pre-reform form, as a fifth column after the four regions. */
export const OLD_COLUMN = 4;
const JAPAN = 3;

/** What deciding a font needs from a group: its forms and its two partitions. */
export interface FontedGroup {
  /** The forms of China, Hong Kong, Taiwan and Japan. */
  chars: readonly string[];
  old?: string;
  /** Glyph partition over the four regions, plus a fifth digit for the old form. */
  glyphSig: string;
  /** Code-point partition over the four regions. */
  cpSig: string;
}

/**
 * The region whose font draws a column (0–3, or OLD_COLUMN).
 *
 * Regions that write a form with the same glyph and code point share the first such region's font,
 * so the others need not carry it (about a third fewer glyphs), and the cells the view calls
 * identical are drawn from one glyph: the signature may join two regions on the serif family alone,
 * and two fonts would then draw two slightly different shapes. The code point must match too: two
 * code points can share a glyph (compatibility ideographs), and a font without the code point
 * draws nothing. Japan's old form borrows the same way, or else takes Japan's font, whose glyph
 * the signature measured.
 */
export const fontRegionOf = (group: FontedGroup, column: number): number => {
  const glyph = group.glyphSig[column];
  if (column === OLD_COLUMN) {
    for (let region = 0; region < OLD_COLUMN; region++)
      if (group.chars[region] === group.old && group.glyphSig[region] === glyph)
        return region;
    return JAPAN;
  }
  for (let region = 0; region < column; region++)
    if (
      group.cpSig[region] === group.cpSig[column] &&
      group.glyphSig[region] === glyph
    )
      return region;
  return column;
};
