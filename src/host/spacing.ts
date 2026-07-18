/**
 * 分かち書き (wakachigaki): learner word-spacing as a deterministic transform — the user's manual
 * practice (spacing out sentences for study and for pasting into slides), automated. Spaces go
 * BETWEEN word groups (a conjugated verb stays whole; particles separate), ruby markup survives
 * ({食|た}べる is atomic inside its word), and removal is the inverse. BACKLOG #38.
 */
import { groupSegments, japaneseRuns, stripRuby } from "./hover";
import { segment } from "./tokenizer";

const HAS_KANJI = /[㐀-鿿豈-﫿]/;
const JA_OR_RUBY_EDGE = /[぀-ゟ゠-ヿ㐀-鿿豈-﫿々〆ヶ{}]/;

/**
 * Insert a space at each word-group boundary inside a line's Japanese runs. Pure-kana runs are
 * left untouched (the tokenizer needs kanji↔kana transitions; wrong boundaries would be worse
 * than none). Indexes compute in ruby-stripped space and map back, so an insertion before a
 * ruby-marked word lands before its `{`.
 */
export const addSpacingToLine = async (line: string): Promise<string> => {
  const stripped = stripRuby(line);
  // Collect original-index insertion points first; apply right-to-left so indexes stay valid.
  const insertions: number[] = [];
  for (const run of japaneseRuns(stripped.text)) {
    if (!HAS_KANJI.test(run.text)) continue;
    const groups = groupSegments(await segment(run.text));
    let offset = run.start;
    for (const group of groups.slice(0, -1)) {
      offset += group.surface.length;
      insertions.push(stripped.starts[offset]);
    }
  }
  let result = line;
  for (const at of insertions.reverse()) {
    result = `${result.slice(0, at)} ${result.slice(at)}`;
  }
  return result;
};

/**
 * Remove learner spacing: delete space runs whose nearest non-space neighbours on BOTH sides are
 * Japanese (or ruby-group braces). Spaces at English↔Japanese boundaries stay — they are real.
 */
export const removeSpacingFromLine = (line: string): string => {
  let result = "";
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === " " || char === "　") {
      let end = i;
      while (end < line.length && (line[end] === " " || line[end] === "　"))
        end++;
      const prev = result.at(-1) ?? "";
      const next = end < line.length ? line[end] : "";
      if (JA_OR_RUBY_EDGE.test(prev) && JA_OR_RUBY_EDGE.test(next)) {
        i = end; // drop the whole space run
        continue;
      }
    }
    result += char;
    i++;
  }
  return result;
};

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

export const addSpacing = async (text: string): Promise<string> =>
  perLine(text, addSpacingToLine);

export const removeSpacing = async (text: string): Promise<string> =>
  perLine(text, removeSpacingFromLine);
