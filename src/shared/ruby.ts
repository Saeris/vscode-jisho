/**
 * Okurigana-aware ruby alignment: pair a word's kanji runs with the slices of its reading that
 * belong to them, so furigana annotates only what needs it — `{食|た}べる`, never `{食べる|たべる}`.
 *
 * The technique: the surface splits into alternating kanji and kana runs. The kana runs are
 * literal anchors that must appear in the reading; whatever falls between them belongs to the
 * kanji runs. Expressed as one anchored regex (kanji → lazy capture, kana → literal), matching
 * hands back each kanji run's reading in a capture group.
 *
 * Ambiguity is possible in principle (two kanji runs separated only by a kana the reading also
 * contains elsewhere), and lazy capture resolves it leftmost-shortest. That's a rare, low-stakes
 * miss for authoring — where the user reviews output — and `null` plus the whole-word fallback
 * covers the cases where nothing matches at all.
 */
import { isKanjiForReading } from "./japanese.ts";

export interface RubySpan {
  /** A run of the surface, in order. Concatenating every `text` rebuilds the surface exactly. */
  text: string;
  /** The reading for this run, when it is kanji and alignment succeeded. */
  ruby?: string;
}

/** Katakana → hiragana, so readings compare against kana surfaces regardless of script. */
export const toHiragana = (text: string): string =>
  text.replace(/[ァ-ヶ]/g, (char) =>
    String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
  );

/** Split into maximal runs, each entirely kanji or entirely not. */
const runs = (surface: string): Array<{ text: string; kanji: boolean }> => {
  const out: Array<{ text: string; kanji: boolean }> = [];
  for (const char of surface) {
    const kanji = isKanjiForReading(char);
    const last = out.at(-1);
    if (last?.kanji === kanji) last.text += char;
    else out.push({ text: char, kanji });
  }
  return out;
};

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pair each kanji run of `surface` with its share of `reading`. Returns null when the two can't be
 * reconciled — a mismatched reading, or a surface with no kanji to annotate.
 */
export const alignReading = (
  surface: string,
  reading: string
): RubySpan[] | null => {
  const parts = runs(surface);
  if (!parts.some((part) => part.kanji)) return null;

  const kana = toHiragana(reading);
  // A kana-only surface would already have returned; every kanji run needs at least one character
  // of reading, and the kana runs must appear verbatim.
  const pattern = parts
    .map((part) => (part.kanji ? "(.+?)" : escapeRegExp(toHiragana(part.text))))
    .join("");
  const match = new RegExp(`^${pattern}$`).exec(kana);
  if (!match) return null;

  let capture = 0;
  return parts.map((part) =>
    part.kanji
      ? { text: part.text, ruby: match[++capture] }
      : { text: part.text }
  );
};

/**
 * Mirrordown ruby markdown: `{食|た}べる`. Falls back to annotating the whole word when the
 * reading can't be aligned — a correct-but-coarse `{漢字|かんじ}` beats dropping the reading.
 */
export const toRubyMarkdown = (surface: string, reading: string): string => {
  const spans = alignReading(surface, reading);
  if (spans === null) {
    return reading === "" || surface === reading
      ? surface
      : `{${surface}|${toHiragana(reading)}}`;
  }
  return spans
    .map((span) => (span.ruby ? `{${span.text}|${span.ruby}}` : span.text))
    .join("");
};

/**
 * The inverse of `toRubyMarkdown`: `{食|た}べる` → `食べる`, unescaping mirrordown's `\x`.
 *
 * Lets the plain form be derived rather than stored beside the annotated one, where the two could
 * drift apart. Distinct from `hover.ts`'s `stripRuby`, which solves a harder problem for EDITOR
 * text — index maps back to the original line, plus emphasis markers — that this does not need.
 */
export const stripRubyText = (text: string): string =>
  text.replace(
    /\{((?:\\.|[^|{}\n])+)\|(?:\\.|[^{}\n])*\}/g,
    // The unescape only has work to do when the base actually carries a `\`, and it ran per match
    // regardless — 1.2% of profile ticks in the example path for a case that occurs in 0 of 133,570
    // corpus sentences. Guarding it keeps the mirrordown contract and skips the pass.
    (_, base: string) =>
      base.includes("\\") ? base.replace(/\\(.)/g, "$1") : base
  );

/** HTML ruby: `<ruby>食<rt>た</rt></ruby>べる`, same fallback behaviour. */
export const toRubyHtml = (surface: string, reading: string): string => {
  const ruby = (text: string, rt: string): string =>
    `<ruby>${text}<rt>${rt}</rt></ruby>`;
  const spans = alignReading(surface, reading);
  if (spans === null) {
    return reading === "" || surface === reading
      ? surface
      : ruby(surface, toHiragana(reading));
  }
  return spans
    .map((span) => (span.ruby ? ruby(span.text, span.ruby) : span.text))
    .join("");
};
