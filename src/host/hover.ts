/**
 * Pure logic for the editor hover provider: find the Japanese text run under the cursor, then
 * pick which tokenized word within it the cursor is on. Kept free of vscode/tokenizer imports so
 * it unit-tests as plain string math.
 */

/** Kana, CJK ideographs (+ compat), the prolonged-sound mark and iteration marks. */
const JA_CHAR = /[぀-ゟ゠-ヿ㐀-鿿豈-﫿々〆ヶ]/;

export interface JaRun {
  text: string;
  /** Offset of the run's first character within the line. */
  start: number;
}

/**
 * The contiguous Japanese run containing `character` in `line`, or null. A cursor sitting just
 * past the last character of a run (hover at word end) still counts.
 */
export const japaneseRunAt = (
  line: string,
  character: number
): JaRun | null => {
  const at = (i: number): boolean =>
    i >= 0 && i < line.length && JA_CHAR.test(line[i]);
  let anchor = character;
  if (!at(anchor)) {
    if (!at(anchor - 1)) return null;
    anchor -= 1;
  }
  let start = anchor;
  while (at(start - 1)) start--;
  let end = anchor + 1;
  while (at(end)) end++;
  return { text: line.slice(start, end), start };
};

export interface RunSegment {
  surface: string;
  lemma: string;
}

/**
 * The segment covering `offset` within the run the segments tile, plus the offset where it starts
 * — the hover's lookup candidate and highlight range. Null when offset falls past the segments
 * (defensive; segments should tile the run exactly).
 */
export const wordAt = <S extends RunSegment>(
  segments: S[],
  offset: number
): { segment: S; start: number } | null => {
  let start = 0;
  for (const segment of segments) {
    const end = start + segment.surface.length;
    if (offset < end) return { segment, start };
    start = end;
  }
  return null;
};
