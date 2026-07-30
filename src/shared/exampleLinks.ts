/**
 * The markup format for linkified example sentences (F1-links) — the single source of truth shared
 * by the build (which EMITS it) and the webview (which PARSES it), so the two can never drift.
 *
 * A sentence is a sequence of plain runs and linked words. A linked word is markdown-link syntax:
 *
 *     [<link text>](<pos>:<entseq>)
 *
 * where the link TEXT is the full word — okurigana and conjugation included — with its furigana
 * nested inside as mirrordown ruby (`{漢字|かんじ}`), so the link SPAN is the correct word boundary
 * and tap target. The target is a short part-of-speech code plus the word's JMdict `ent_seq`
 * (= `words.id`), so a tap opens that entry directly. Only content words that resolved to an entry
 * are linked; particles, punctuation, and unresolved runs stay as plain text (with any furigana).
 *
 * Example:  `お[{茶|ちゃ}](n:1000710)を[{飲|の}みませんか](v:1168720)`
 */
import type { PartOfSpeech } from "./messages";
import { stripRubyText } from "./ruby.ts";

/**
 * Compact codes for each part of speech, and the inverse. Stable — the DB stores the codes. Declared
 * as two explicit maps (rather than deriving one from the other) so the code↔pos mapping needs no
 * type assertions and stays a single obvious source of truth.
 */
export const POS_CODE: Record<PartOfSpeech, string> = {
  noun: "n",
  verb: "v",
  adjective: "adj",
  adverb: "adv",
  particle: "p",
  auxiliary: "aux",
  other: "o"
};

const CODE_POS: Record<string, PartOfSpeech> = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
  p: "particle",
  aux: "auxiliary",
  o: "other"
};

/** Build one linked-word token: `[text](code:id)`. `text` may contain nested `{漢字|かんじ}` ruby. */
export const linkToken = (
  text: string,
  pos: PartOfSpeech,
  entseq: string
): string => `[${text}](${POS_CODE[pos]}:${entseq})`;

/** One piece of a parsed sentence: a linked word, or a plain run. Both may carry ruby markup. */
export type ExamplePart =
  | { kind: "link"; markup: string; pos: PartOfSpeech; id: string }
  | { kind: "text"; markup: string };

// A markdown link whose target is `<code>:<entseq>`. The link text is non-greedy and forbids a
// literal `]` (Japanese sentences never contain one), so nested ruby braces don't confuse it.
const LINK = /\[([^\]]+)\]\(([a-z]+):(\d+)\)/gu;

/**
 * Split linkified example markup into render parts, in order. Text between links (and any text that
 * isn't a link) becomes `text` parts; a matched `[…](code:id)` becomes a `link` part carrying the
 * inner markup (still possibly ruby) plus the resolved POS and id. The webview renders each part —
 * ruby via the shared renderer, links as tappable spans.
 */
export const parseExampleMarkup = (markup: string): ExamplePart[] => {
  const parts: ExamplePart[] = [];
  let lastIndex = 0;
  for (const match of markup.matchAll(LINK)) {
    const [whole, text, code, id] = match;
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ kind: "text", markup: markup.slice(lastIndex, start) });
    }
    parts.push({
      kind: "link",
      markup: text,
      pos: CODE_POS[code] ?? "other",
      id
    });
    lastIndex = start + whole.length;
  }
  if (lastIndex < markup.length) {
    parts.push({ kind: "text", markup: markup.slice(lastIndex) });
  }
  return parts;
};

/**
 * The sentence as plain text: both markup layers removed, links first then ruby.
 *
 * For surfaces that cannot render either — the editor hover, whose markdown VS Code sanitizes down
 * to a fixed subset. `stripRubyText` alone is NOT enough and failing to notice that is what shipped
 * `[もっと](adv:1012620)` into the word page: stripping ruby leaves the link syntax intact, so a
 * consumer that only knows about ruby prints half the markup and looks like it worked.
 */
export const exampleText = (markup: string): string =>
  stripRubyText(markup.replace(LINK, "$1"));
