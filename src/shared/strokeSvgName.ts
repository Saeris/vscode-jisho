/**
 * The on-disk name of a character's stroke drawing, without its extension.
 *
 * Shared by the build (which writes the files) and the host (which reads them), because a filename
 * derived in two places is a filename that can disagree in one.
 *
 * A decimal CODEPOINT rather than the character itself. The literal is far easier to read while
 * developing, and it is what this shipped with — but a non-ASCII filename is only as stable as
 * whatever normalizes it, and two environments disagreed:
 *
 *  - macOS reported all 146 kana drawings as modified after a fresh clone (HFS+/APFS normalize to a
 *    decomposed form that git does not).
 *  - The VS Code Marketplace rejected the upload with "Item has already been added. Key in
 *    dictionary: 'extension/assets/kana-svgs/….svg'" — a case-insensitive .NET dictionary folding
 *    two distinct kana onto one key.
 *
 * Neither reproduces on Windows or Linux, so neither was catchable locally. Digits are pure ASCII
 * and cannot collide under any normalization, case fold, or filesystem encoding.
 *
 * DECIMAL, matching AnimCJK's own naming (`fetch(`${base}/${codepoint}.svg`)` interpolates the
 * number `codePointAt` returns), so the build's output name is the same string as its upstream
 * source name.
 */
export const strokeSvgName = (literal: string): string | undefined => {
  const codepoint = literal.codePointAt(0);
  // A drawing is one character. Anything longer (a digraph like きゃ) has no file, and the caller
  // must not turn that into a filesystem probe.
  if (codepoint === undefined || Array.from(literal).length !== 1) {
    return undefined;
  }
  return String(codepoint);
};
