/**
 * Request → response dispatch: the seam between the webview's message protocol and the query layer.
 *
 * Split out of extension.ts because almost none of it needs the extension host — only `openSettings`
 * and `copyText` touch the vscode API, and they live here because they answer requests like the rest.
 * The switches are deliberately exhaustive rather than table-driven: the compiler checking every
 * member of the request union is worth more than the lines a lookup table would save.
 */
import * as vscode from "vscode";
import type { Dictionary } from "./db";
import { hasKanji } from "../shared/japanese";
import { timed } from "./log";
import type { NamesDictionary } from "./names";
import { contentSegmentCount, segment } from "./tokenizer";
import type {
  CopyTextRequest,
  OpenSettingsRequest,
  Request,
  Response,
  SegmentDto
} from "../shared/messages";

interface QueryAnalysis {
  /** Breakdown chips — only when a Japanese query has >1 content word. */
  segments: SegmentDto[];
  /** Content-word dictionary forms, fed to search as deinflection candidates. */
  lemmas: string[];
}

/**
 * Tokenize a Japanese query once, deriving both the breakdown segments and the content lemmas.
 * Only mixed-script (kanji-bearing) input tokenizes reliably — English/romaji and pure-kana
 * queries never load the tokenizer's dictionary and rely on rule-based deinflection instead. A
 * single conjugated word (食べました) yields one lemma (食べる) for the search merge but no breakdown.
 */
const analyzeQuery = async (query: string): Promise<QueryAnalysis> => {
  const trimmed = query.trim();
  if (trimmed.length < 2 || !hasKanji(trimmed)) {
    return { segments: [], lemmas: [] };
  }
  // The tokenizer's first call pays a WASM + IPADIC init (~200ms locally, but it is a 12MB
  // dictionary and cold disk can be far worse) — and `search` awaits it BEFORE querying, so any
  // stall here delays word results while the names query, which skips tokenizing, answers first.
  const all = await timed("tokenize query", async () => segment(trimmed));
  const lemmas = all
    .filter((s) => s.pos !== "particle" && s.pos !== "auxiliary")
    .map((s) => s.lemma)
    .filter((l) => l !== "" && l !== trimmed);
  const segments = contentSegmentCount(all) > 1 ? all : [];
  return { segments, lemmas };
};

/** The sidebar's ⚙: open VS Code's Settings UI filtered to this extension's section. */
export const openSettings = (request: OpenSettingsRequest): Response => {
  void vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "@ext:saeris.vscode-jisho"
  );
  return { type: "openSettings", requestId: request.requestId };
};

/** Copy-as: the host owns the clipboard, since the webview's needs user activation. */
export const copyText = async (request: CopyTextRequest): Promise<Response> => {
  await vscode.env.clipboard.writeText(request.text);
  return { type: "copyText", requestId: request.requestId };
};

/** Requests served by the word/kanji dictionary (not the names DB, not the file-backed SVGs). */
type WordRequest = Exclude<
  Request,
  | { type: "searchNames" }
  | { type: "getName" }
  | { type: "getStrokeSvg" }
  | { type: "openSettings" }
  | { type: "copyText" }
>;

/** Dispatch a word/kanji request to the dictionary and build its response. */
export const respond = async (
  dict: Dictionary,
  request: WordRequest
): Promise<Response> => {
  switch (request.type) {
    case "search": {
      // Tokenize once (Japanese only): segments feed the breakdown bar, lemmas feed search's
      // deinflection merge — the tokenizer is more accurate than the rule-based fallback.
      const analysis = await analyzeQuery(request.query);
      const [results, kanji] = await Promise.all([
        dict.search(request.query, 50, analysis.lemmas),
        dict.searchKanji(request.query)
      ]);
      return {
        type: "search",
        requestId: request.requestId,
        results,
        kanji,
        segments: analysis.segments
      };
    }
    case "getWord":
      return {
        type: "getWord",
        requestId: request.requestId,
        word: await dict.getWord(request.id)
      };
    case "getMoreExamples":
      return {
        type: "getMoreExamples",
        requestId: request.requestId,
        examples: await dict.getMoreExamples(request.id)
      };
    case "getKanji":
      return {
        type: "getKanji",
        requestId: request.requestId,
        kanji: await dict.getKanji(request.literal)
      };
    case "getComponentTree":
      return {
        type: "getComponentTree",
        requestId: request.requestId,
        tree: await dict.getComponentTree(request.literal)
      };
    case "lookupRadicals":
      return {
        type: "lookupRadicals",
        requestId: request.requestId,
        result: await dict.lookupRadicals(request.selected)
      };
    case "getAbout":
      return {
        type: "getAbout",
        requestId: request.requestId,
        meta: await dict.getMeta()
      };
  }
};

/** Requests served by the optional names dictionary. */
type NamesRequest = Extract<
  Request,
  { type: "searchNames" } | { type: "getName" }
>;

/** Dispatch a names request to the (separately-provisioned) names dictionary. */
export const respondNames = async (
  names: NamesDictionary,
  request: NamesRequest
): Promise<Response> => {
  switch (request.type) {
    case "searchNames":
      return {
        type: "searchNames",
        requestId: request.requestId,
        names: await names.searchNames(request.query)
      };
    case "getName":
      return {
        type: "getName",
        requestId: request.requestId,
        name: await names.getName(request.id)
      };
  }
};
