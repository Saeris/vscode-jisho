/**
 * The markup format for linkified example sentences (F1-links) — the single source of truth shared
 * by the build (which EMITS it) and the webview (which PARSES it), so the two can never drift.
 *
 * A sentence is a sequence of plain runs and annotated words, in markdown-link syntax:
 *
 *     [<link text>](<pos>:<entseq>)   — a word with an entry: coloured AND tappable
 *     [<link text>](<pos>:)           — a word without one:  coloured, not tappable
 *
 * where the TEXT is the full word — okurigana and conjugation included — with its furigana nested
 * inside as mirrordown ruby (`{漢字|かんじ}`), so the span is the correct word boundary and tap
 * target. The target is a short part-of-speech code plus the word's JMdict `ent_seq` (= `words.id`)
 * when there is one.
 *
 * The empty-id form exists because colouring and linking are different questions (#38). Linking は
 * to a dictionary entry helps nobody, so only content words get an id — but は still has a part of
 * speech, and particles are 29% of all tokens and the visible word boundary. When the second form
 * did not exist, examples could colour only 4 of the 9 palette categories (68.7% of characters),
 * which is why they looked unlike the editor's highlighting of the same sentence.
 *
 * Only punctuation, whitespace and `other`-classed runs remain unannotated plain text.
 *
 * Example:  `お[{茶|ちゃ}](n:1000710)[を](p:)[{飲|の}みませんか](v:1168720)`
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
  // Added with the nine-category palette. The pre-existing codes above keep their meaning, so
  // markup already in the DB still parses to the same category; only newly built rows use these.
  pronoun: "pn",
  adnominal: "adn",
  utterance: "utt",
  other: "o"
};

const CODE_POS: Record<string, PartOfSpeech> = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
  p: "particle",
  aux: "auxiliary",
  pn: "pronoun",
  adn: "adnominal",
  utt: "utterance",
  o: "other"
};

/** Build one linked-word token: `[text](code:id)`. `text` may contain nested `{漢字|かんじ}` ruby. */
export const linkToken = (
  text: string,
  pos: PartOfSpeech,
  entseq: string
): string => `[${text}](${POS_CODE[pos]}:${entseq})`;

/**
 * Build a TYPED-BUT-UNLINKED token: `[text](code:)`, an empty id.
 *
 * For words that have a part of speech worth showing but no dictionary entry worth opening —
 * particles, auxiliaries, and any content word the build could not resolve. Colouring and linking
 * are genuinely different questions: linking は to a JMdict entry helps nobody, but は is exactly
 * what a learner needs to see delimited, and it is 29% of all tokens.
 *
 * Same shape as `linkToken` on purpose, so one grammar covers both and `exampleText` keeps
 * stripping them with the same pass.
 */
export const posToken = (text: string, pos: PartOfSpeech): string =>
  `[${text}](${POS_CODE[pos]}:)`;

/**
 * One piece of a parsed sentence. All three may carry ruby markup.
 *
 * `link` and `span` differ only in whether there is an entry to open — both carry a part of speech,
 * so both colour. `text` is what carries no grammatical claim at all: punctuation, whitespace, and
 * anything the tokenizer classed as `other`.
 */
export type ExamplePart =
  | { kind: "link"; markup: string; pos: PartOfSpeech; id: string }
  | { kind: "span"; markup: string; pos: PartOfSpeech }
  | { kind: "text"; markup: string };

// A markdown link whose target is `<code>:<entseq>`, where the entseq may be EMPTY (`\d*`, not
// `\d+`) — that is the typed-but-unlinked form. The link text is non-greedy and forbids a literal
// `]` (Japanese sentences never contain one), so nested ruby braces don't confuse it.
//
// One pattern for both forms is the point: `exampleText` strips markup with a single
// `replace(LINK, "$1")`, and a second grammar would be a second thing every consumer has to know
// about — exactly how `[もっと](adv:1012620)` once leaked into the word page.
const LINK = /\[([^\]]+)\]\(([a-z]+):(\d*)\)/gu;

/**
 * Split linkified example markup into render parts, in order.
 *
 * A `[…](code:id)` becomes a `link` part; the same with an empty id becomes a `span` part; anything
 * between them becomes `text`. Each carries its inner markup (still possibly ruby), which the
 * webview renders through the shared ruby renderer.
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
    const pos = CODE_POS[code] ?? "other";
    parts.push(
      id === ""
        ? { kind: "span", markup: text, pos }
        : { kind: "link", markup: text, pos, id }
    );
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
