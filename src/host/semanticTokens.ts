/**
 * Part-of-speech semantic highlighting for Japanese prose (BACKLOG #38) — a syntax highlighter for
 * text rather than code, so learners can see the word boundaries spaces do not mark.
 */
import * as vscode from "vscode";
import { japaneseRuns, stripRuby } from "./hover";
import { hasKanji } from "../shared/japanese";
import { segment } from "./tokenizer";

/**
 * POS → built-in semantic token types, chosen so every theme colors them out of the box (BACKLOG
 * #38, the remark-ayaji idea): particles read as the grammar "keywords" they are, verbs as
 * "functions", and so on. Morpheme-level: auxiliaries color separately from their verb stem, so a
 * conjugation's internal structure is visible. "other" gets no token (theme default).
 */
const POS_TOKEN_TYPES = [
  "function", // verb
  "variable", // noun
  "type", // adjective
  "property", // adverb
  "keyword", // particle
  "macro" // auxiliary
];
const POS_TOKEN: Record<string, number | undefined> = {
  verb: 0,
  noun: 1,
  adjective: 2,
  adverb: 3,
  particle: 4,
  auxiliary: 5
};
export const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(POS_TOKEN_TYPES);

/**
 * Color Japanese text by part of speech — a syntax highlighter for prose, so learners can see the
 * word boundaries spaces don't mark. Ruby-markup aware like the hover: a `{食|た}べる` group is
 * colored whole (braces and reading included) as its word.
 */
export const provideSemanticTokens = async (
  document: vscode.TextDocument,
  token: vscode.CancellationToken
): Promise<vscode.SemanticTokens | undefined> => {
  const enabled = vscode.workspace
    .getConfiguration("vscode-jisho")
    .get<boolean>("highlighting.enabled", false);
  const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
  if (!enabled) return builder.build(); // empty set clears any previous coloring
  for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
    if (token.isCancellationRequested) return undefined;
    const stripped = stripRuby(document.lineAt(lineNo).text);
    for (const run of japaneseRuns(stripped.text)) {
      // Same constraint as the hover: pure-kana runs tokenize into garbage (no script
      // transitions), and wrong coloring teaches wrong boundaries — skip them.
      if (!hasKanji(run.text)) continue;
      const segments = await segment(run.text);
      let offset = run.start;
      for (const seg of segments) {
        for (const part of seg.parts) {
          const tokenType = POS_TOKEN[part.pos];
          const end = offset + part.surface.length;
          if (tokenType !== undefined) {
            const origStart = stripped.starts[offset];
            const origEnd = stripped.ends[end - 1];
            builder.push(lineNo, origStart, origEnd - origStart, tokenType, 0);
          }
          offset = end;
        }
      }
    }
  }
  return builder.build();
};
