import * as vscode from "vscode";
import { Dictionary } from "./host/db";
import { ensureDatabase } from "./host/ensureDatabase";
import { contentSegmentCount, segment } from "./host/tokenizer";
import type { Request, Response, SegmentDto } from "./shared/messages";

const VIEW_ID = "vscode-jisho.searchView";

const HAS_JAPANESE = /[぀-ヿ㐀-鿿豈-﫿]/;

interface QueryAnalysis {
  /** Breakdown chips — only when a Japanese query has >1 content word. */
  segments: SegmentDto[];
  /** Content-word dictionary forms, fed to search as deinflection candidates. */
  lemmas: string[];
}

/**
 * Tokenize a Japanese query once, deriving both the breakdown segments and the content lemmas.
 * English/romaji queries never load the tokenizer's dictionary. A single conjugated word
 * (食べました) yields one lemma (食べる) for the search merge but no breakdown bar.
 */
const analyzeQuery = async (query: string): Promise<QueryAnalysis> => {
  const trimmed = query.trim();
  if (trimmed.length < 2 || !HAS_JAPANESE.test(trimmed)) {
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
      const dict = await this.#dict();
      const response = await respond(dict, request);
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
    if (this.#dictionary) {
      try {
        await (await this.#dictionary).close();
      } catch {
        // best-effort close on shutdown
      }
    }
  }
}

/** Dispatch a request to the dictionary and build its response. */
const respond = async (
  dict: Dictionary,
  request: Request
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

const makeNonce = (): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++)
    nonce += chars[Math.floor(Math.random() * chars.length)];
  return nonce;
};
