/**
 * Furigana annotation as an editor transform: wrap kanji-bearing words in mirrordown ruby syntax
 * ({食|た}べる) using the tokenizer's readings, and strip it back off. The counterpart to
 * spacing.ts — same whole-line, ruby-aware, right-to-left splicing shape. BACKLOG #33.
 */
import { groupSegments, japaneseRuns, stripRuby } from "./hover";
import { toRubyMarkdown } from "../shared/ruby";
import { segment } from "./tokenizer";

const HAS_KANJI = /[㐀-鿿豈-﫿]/;

/**
 * Annotate every kanji-bearing word group in a line. Words that already carry ruby markup are
 * left alone (the stripped span differs from the original), pure-kana runs are skipped (the
 * tokenizer needs script transitions), and each group's reading comes from its own morphemes so
 * conjugations annotate as one word.
 */
export const addFuriganaToLine = async (line: string): Promise<string> => {
  const stripped = stripRuby(line);
  // Collect replacements first, apply right-to-left so earlier indexes stay valid.
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const run of japaneseRuns(stripped.text)) {
    if (!HAS_KANJI.test(run.text)) continue;
    const groups = groupSegments(await segment(run.text));
    let offset = run.start;
    for (const group of groups) {
      const start = offset;
      const end = offset + group.surface.length;
      offset = end;
      if (!HAS_KANJI.test(group.surface)) continue;

      const origStart = stripped.starts[start];
      const origEnd = stripped.ends[end - 1];
      // Already annotated: the original span is wider than the plain text it maps to, which only
      // happens when ruby markup sits inside it. Re-wrapping would nest braces.
      if (origEnd - origStart !== group.surface.length) continue;

      const reading = group.parts.map((part) => part.reading ?? "").join("");
      if (reading === "") continue;
      const annotated = toRubyMarkdown(group.surface, reading);
      if (annotated !== group.surface) {
        edits.push({ start: origStart, end: origEnd, text: annotated });
      }
    }
  }
  let result = line;
  for (const edit of edits.reverse()) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
};

/** Remove every ruby group, leaving the base text — exactly what the readers already parse. */
export const removeFuriganaFromLine = (line: string): string =>
  stripRuby(line).text;

/** Split-transform-join over lines, preserving the text's own line endings. */
const perLine = async (
  text: string,
  transform: (line: string) => Promise<string> | string
): Promise<string> => {
  const parts = text.split(/(\r?\n)/);
  const out: string[] = [];
  for (const part of parts) {
    out.push(/^\r?\n$/.test(part) ? part : await transform(part));
  }
  return out.join("");
};

export const addFurigana = async (text: string): Promise<string> =>
  perLine(text, addFuriganaToLine);

export const removeFurigana = async (text: string): Promise<string> =>
  perLine(text, removeFuriganaFromLine);
