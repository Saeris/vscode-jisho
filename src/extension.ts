import * as vscode from "vscode";
import { Dictionary } from "./host/db";
import { NamesDictionary } from "./host/names";
import { ensureDatabase, ensureNamesDatabase } from "./host/ensureDatabase";
import { contentSegmentCount, segment } from "./host/tokenizer";
import type { Request, Response, SegmentDto } from "./shared/messages";

const VIEW_ID = "vscode-jisho.searchView";

// Requires at least one kanji (CJK ideograph). IPADIC's Viterbi lattice relies on kanji↔kana
// script transitions to find word boundaries; all-kana input (にほんごをはなしますか) has no such
// signal and tokenizes into garbage fragments (に·ほん·ご·を…). So we only tokenize mixed-script
// input — pure-kana and romaji fall through to the rule-based deinflection path, which handles
// their conjugation (はなします → 話す) correctly.
const HAS_KANJI = /[㐀-鿿豈-﫿]/;

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
  if (trimmed.length < 2 || !HAS_KANJI.test(trimmed)) {
    return { segments: [], lemmas: [] };
  }
  const all = await segment(trimmed);
  const lemmas = all
    .filter((s) => s.pos !== "particle" && s.pos !== "auxiliary")
    .map((s) => s.lemma)
    .filter((l) => l !== "" && l !== trimmed);
  const segments = contentSegmentCount(all) > 1 ? all : [];
  return { segments, lemmas };
};

export function activate(context: vscode.ExtensionContext): void {
  const provider = new JishoViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    provider
  );
}

export function deactivate(): void {}

/**
 * Serves the React webview into the sidebar and bridges its messages to the dictionary. The DB is
 * opened lazily on first message so activation stays fast and any provisioning error surfaces in
 * the UI rather than crashing activation.
 */
class JishoViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  #context: vscode.ExtensionContext;
  #dictionary: Promise<Dictionary> | undefined;
  #names: Promise<NamesDictionary> | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
  }

  async #dict(): Promise<Dictionary> {
    // Open once, reuse. If opening fails, clear the cache so a later message can retry.
    this.#dictionary ??= (async (): Promise<Dictionary> => {
      try {
        const path = await ensureDatabase(this.#context);
        return await Dictionary.open(path);
      } catch (err) {
        this.#dictionary = undefined;
        throw err;
      }
    })();
    return this.#dictionary;
  }

  async #namesDict(): Promise<NamesDictionary> {
    // The names DB is a separate, opt-in download provisioned on first names query. Same
    // open-once/retry-on-failure discipline as the word DB.
    this.#names ??= (async (): Promise<NamesDictionary> => {
      try {
        const path = await ensureNamesDatabase(this.#context);
        return await NamesDictionary.open(path);
      } catch (err) {
        this.#names = undefined;
        throw err;
      }
    })();
    return this.#names;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.#context.extensionUri, "dist", "webview")
      ]
    };
    view.webview.html = this.#html(view.webview);
    view.webview.onDidReceiveMessage((msg: Request) => {
      void this.#handle(view.webview, msg);
    });
  }

  async #handle(webview: vscode.Webview, request: Request): Promise<void> {
    try {
      const response =
        request.type === "searchNames" || request.type === "getName"
          ? await respondNames(await this.#namesDict(), request)
          : await respond(await this.#dict(), request);
      await webview.postMessage(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error: Response = {
        type: "error",
        requestId: request.requestId,
        message
      };
      await webview.postMessage(error);
    }
  }

  #html(webview: vscode.Webview): string {
    const base = vscode.Uri.joinPath(
      this.#context.extensionUri,
      "dist",
      "webview"
    );
    const script = webview
      .asWebviewUri(vscode.Uri.joinPath(base, "index.js"))
      .toString();
    const style = webview
      .asWebviewUri(vscode.Uri.joinPath(base, "index.css"))
      .toString();
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <title>Jisho</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }

  async dispose(): Promise<void> {
    for (const opened of [this.#dictionary, this.#names]) {
      if (opened) {
        try {
          await (await opened).close();
        } catch {
          // best-effort close on shutdown
        }
      }
    }
  }
}

/** Requests served by the word/kanji dictionary (everything except the names DB). */
type WordRequest = Exclude<
  Request,
  { type: "searchNames" } | { type: "getName" }
>;

/** Dispatch a word/kanji request to the dictionary and build its response. */
const respond = async (
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
    case "getKanji":
      return {
        type: "getKanji",
        requestId: request.requestId,
        kanji: await dict.getKanji(request.literal)
      };
    case "getStrokeSvg":
      return {
        type: "getStrokeSvg",
        requestId: request.requestId,
        svg: await dict.getStrokeSvg(request.literal)
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
const respondNames = async (
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

const makeNonce = (): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++)
    nonce += chars[Math.floor(Math.random() * chars.length)];
  return nonce;
};
