/**
 * The editor hover: orchestrates run detection, tokenizing, grammar-note routing, and dictionary
 * lookup into a `vscode.Hover`. Extracted from `extension.ts` to keep the entry point to
 * registration — the string/markup logic lives in `./hover`, `../shared/grammar`, and
 * `../shared/hoverHtml`; this file is the vscode-facing seam that glues them to the DB.
 *
 * Routing rule (the "one hover, one subject" fix): the cursor sits on exactly one thing, and the
 * hover explains THAT.
 *   - on a particle          → its grammar note (JMdict's gloss is what the reader is stuck on)
 *   - on an auxiliary         → its grammar note (the 〜たい under the cursor, not the base word)
 *   - on a content word       → its dictionary definition
 * A definition and a grammar note never render together — hovering 置きたい's たい shows the 〜たい
 * note alone; hovering 置き shows the 置く definition alone.
 */
import * as vscode from "vscode";
import {
  auxiliaryAt,
  describeGroupHtml,
  groupSegments,
  japaneseRunAt,
  resolveWord,
  stripRuby,
  toStrippedIndex,
  type SegmentGroup
} from "./hover";
import {
  AUXILIARY_NOTES,
  PARTICLE_NOTES,
  noteToMarkdown,
  type GrammarNote
} from "../shared/grammar";
import { wordHoverMarkdown } from "../shared/hoverHtml";
import type { DetailedSegment } from "./tokenizer";
import type { WordDetailDto } from "../shared/messages";

/** Requires at least one kanji: pure-kana runs tokenize into garbage (no script transitions). */
const HAS_KANJI = /[㐀-鿿豈-﫿]/;

/**
 * Everything the hover needs from the outside world, injected so this module stays free of the
 * provider class and the vscode config singleton — and unit-testable with fakes.
 */
export interface HoverDeps {
  /** Whether the hover is enabled at all (the `hover.enabled` setting). */
  hoverEnabled: () => boolean;
  /** Whether grammar notes are shown (the `grammar.enabled` setting). */
  grammarEnabled: () => boolean;
  /** Tokenize a Japanese run into folded segments. */
  segment: (text: string) => Promise<DetailedSegment[]>;
  /** Search for the best dictionary match id for a lookup form. */
  search: (
    lookup: string,
    limit: number
  ) => Promise<Array<{ id: string; headword: string }>>;
  /** Full entry for an id. */
  getWord: (id: string) => Promise<WordDetailDto | null>;
}

/** Build a non-trusted, HTML-enabled grammar-note hover body. */
const grammarMarkdown = (markdown: string): vscode.MarkdownString => {
  const md = new vscode.MarkdownString(undefined, true);
  md.supportHtml = true;
  md.appendMarkdown(markdown);
  return md;
};

/** A grammar-note hover over a given original-line span. */
const noteHover = (
  heading: string,
  note: GrammarNote,
  line: number,
  startCol: number,
  endCol: number
): vscode.Hover =>
  new vscode.Hover(
    grammarMarkdown(noteToMarkdown(heading, note)),
    new vscode.Range(line, startCol, line, endCol)
  );

export const provideHover = async (
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  deps: HoverDeps
): Promise<vscode.Hover | undefined> => {
  if (!deps.hoverEnabled()) return undefined;

  // Work on the line with mirrordown ruby markup stripped ({食|た}べました → 食べました): the braces
  // would otherwise split the Japanese run. All indexes below are stripped-space; the maps translate
  // back for the highlight range.
  const line = document.lineAt(position.line).text;
  const stripped = stripRuby(line);
  const cursor = toStrippedIndex(stripped, position.character);
  const run = japaneseRunAt(stripped.text, cursor);
  if (run === null) return undefined;

  // A particle that is its own run (the は in これは、) never reaches the tokenizer path below, which
  // only tokenizes kanji-bearing runs. Answer it directly: a single character has no segmentation to
  // get wrong.
  if (deps.grammarEnabled() && Array.from(run.text).length === 1) {
    const particle = PARTICLE_NOTES[run.text];
    if (particle) {
      return noteHover(
        run.text,
        particle,
        position.line,
        stripped.starts[run.start],
        stripped.ends[run.start]
      );
    }
  }

  // Group auxiliaries (and a verb's て/で) onto their verb/adjective, so hovering anywhere in
  // 食べたくなかった resolves 食べる — not the たい fragment under the cursor.
  const groups = HAS_KANJI.test(run.text)
    ? groupSegments(await deps.segment(run.text))
    : [];
  const {
    surface,
    lookup,
    start: wordStart,
    group
  } = resolveWord(run, groups, cursor);

  // A particle inside a longer run (the を in 本を読みます) is its own segment. Grammar note, not the
  // JMdict lexicographer gloss.
  if (deps.grammarEnabled() && group?.parts[0]?.pos === "particle") {
    const particle = PARTICLE_NOTES[group.surface];
    if (particle) {
      return noteHover(
        group.surface,
        particle,
        position.line,
        stripped.starts[wordStart],
        stripped.ends[wordStart + group.surface.length - 1]
      );
    }
  }

  // The auxiliary under the cursor (the たい in 置きたい): its grammar note REPLACES the word
  // definition. The cursor is on the aux, so the aux is what the hover explains — not the base word.
  // This is the "one hover, one subject" rule; stacking both buried the word's meaning and was the
  // reported double-match.
  if (deps.grammarEnabled()) {
    const auxLemma = group ? auxiliaryAt(group, wordStart, cursor) : null;
    const auxNote = auxLemma === null ? undefined : AUXILIARY_NOTES[auxLemma];
    if (auxLemma !== null && auxNote !== undefined) {
      return noteHover(
        `〜${auxLemma}`,
        auxNote,
        position.line,
        stripped.starts[wordStart],
        stripped.ends[wordStart + surface.length - 1]
      );
    }
  }

  // Content word → dictionary definition.
  if (Array.from(lookup).length > 12) return undefined; // a long kana sentence isn't a lookup
  const results = await deps.search(lookup, 1);
  if (token.isCancellationRequested || results.length === 0) return undefined;
  const word = await deps.getWord(results[0].id);
  if (word === null) return undefined;

  const md = wordDefinitionMarkdown(word, results[0].headword, group);
  return new vscode.Hover(
    md,
    new vscode.Range(
      position.line,
      stripped.starts[wordStart],
      position.line,
      stripped.ends[wordStart + surface.length - 1]
    )
  );
};

/** The rich word-definition body: ruby headword, breakdown, glosses, POS pills, example, link. */
const wordDefinitionMarkdown = (
  word: WordDetailDto,
  headword: string,
  group: SegmentGroup | undefined
): vscode.MarkdownString => {
  const reading = word.kana.length > 0 ? word.kana[0].text : "";
  // The HTML breakdown (each auxiliary an <ins title> tag) — only for a genuinely conjugated group.
  const breakdown = group ? describeGroupHtml(group) : null;
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: ["vscode-jisho.lookupText"] };
  md.supportHtml = true;
  const body = wordHoverMarkdown({
    headword,
    reading,
    breakdown,
    senses: word.senses
  });
  const tail = [
    body,
    "---",
    `[Open in Jisho](command:vscode-jisho.lookupText?${encodeURIComponent(JSON.stringify(headword))})`
  ];
  md.appendMarkdown(tail.join("\n\n"));
  return md;
};
