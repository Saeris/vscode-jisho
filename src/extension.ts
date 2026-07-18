import * as vscode from "vscode";
import { Dictionary } from "./host/db";
import { NamesDictionary } from "./host/names";
import { ensureDatabase, ensureNamesDatabase } from "./host/ensureDatabase";
import {
  describeGroup,
  groupSegments,
  japaneseRunAt,
  stripRuby,
  toStrippedIndex,
  wordAt
} from "./host/hover";
import { contentSegmentCount, segment } from "./host/tokenizer";
import type {
  GetStrokeSvgRequest,
  HostPush,
  Request,
  Response,
  SegmentDto,
  WebviewReady
} from "./shared/messages";

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

/** The active editor's selected text, trimmed; undefined when there is none. */
const selectionText = (): string | undefined => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const text = editor.document.getText(editor.selection).trim();
  return text === "" ? undefined : text;
};

export function activate(context: vscode.ExtensionContext): void {
  const provider = new JishoViewProvider(context);
  const pushSelection = (action: HostPush["action"]) => (): void => {
    const text = selectionText();
    if (text !== undefined) provider.push({ type: "hostPush", action, text });
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(
      "vscode-jisho.lookupSelection",
      pushSelection("search")
    ),
    vscode.commands.registerCommand(
      "vscode-jisho.speakSelection",
      pushSelection("speak")
    ),
    // Internal (not in contributes): the hover's "Open in Jisho" link runs this with its word.
    vscode.commands.registerCommand("vscode-jisho.lookupText", (text: string) =>
      provider.push({ type: "hostPush", action: "search", text })
    ),
    vscode.languages.registerHoverProvider(["markdown", "plaintext"], {
      provideHover: async (document, position, token) =>
        provider.hover(document, position, token)
    }),
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
  #view: vscode.WebviewView | undefined;
  /** Set when the webview's bridge has said `webviewReady` — pushes before that would be lost. */
  #ready = false;
  #queuedPushes: HostPush[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
  }

  /**
   * Deliver an editor-command push, revealing the sidebar. A webview that isn't resolved (or whose
   * bridge hasn't attached yet) can't receive messages — those pushes queue and flush on
   * `webviewReady`, so a command issued before the panel ever opened still lands.
   */
  push(message: HostPush): void {
    // The `<viewId>.focus` command is auto-registered by VS Code; it opens and reveals the view,
    // triggering resolveWebviewView when needed.
    void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    if (this.#ready && this.#view) {
      void this.#view.webview.postMessage(message);
    } else {
      this.#queuedPushes.push(message);
    }
  }

  /**
   * Dictionary hover for Japanese text (prototype, BACKLOG #33): the run under the cursor is
   * tokenized to isolate the hovered word, its dictionary entry renders as reading + first-sense
   * glosses, and "Open in Jisho" pushes the word into the sidebar. Pure-kana runs skip the
   * tokenizer (it needs kanji↔kana transitions) and search the run whole — deinflection covers it.
   */
  async hover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    // Work on the line with mirrordown ruby markup stripped ({食|た}べました → 食べました): the
    // braces would otherwise split the Japanese run and the hover would see fragments. All
    // indexes below are stripped-space; the maps translate back for the highlight range.
    const line = document.lineAt(position.line).text;
    const stripped = stripRuby(line);
    const cursor = toStrippedIndex(stripped, position.character);
    const run = japaneseRunAt(stripped.text, cursor);
    if (run === null) return undefined;

    let surface = run.text;
    let lookup = run.text;
    let wordStart = run.start;
    let breakdown: string | null = null;
    if (HAS_KANJI.test(run.text)) {
      // Group auxiliaries (and a verb's て/で) onto their verb/adjective, so hovering anywhere in
      // 食べたくなかった describes 食べる — not the たい fragment under the cursor.
      const groups = groupSegments(await segment(run.text));
      if (token.isCancellationRequested) return undefined;
      const hit = wordAt(groups, cursor - run.start);
      if (hit !== null) {
        surface = hit.segment.surface;
        lookup = hit.segment.lemma === "" ? surface : hit.segment.lemma;
        wordStart = run.start + hit.start;
        // The detected form's structure — what the conjugation MEANS here (user request).
        breakdown = describeGroup(hit.segment);
      }
    }
    // Guard the whole-run fallback: hovering a long kana-only sentence isn't a word lookup.
    if (Array.from(lookup).length > 12) return undefined;

    const dict = await this.#dict();
    const results = await dict.search(lookup, 1);
    if (token.isCancellationRequested || results.length === 0) return undefined;
    // No further cancellation check: VS Code discards a stale hover result on its own.
    const word = await dict.getWord(results[0].id);
    if (word === null) return undefined;

    const reading = word.kana.length > 0 ? word.kana[0].text : "";
    const glosses = word.senses[0]?.glosses.slice(0, 3).join("; ") ?? "";
    const pos = word.senses[0]?.partOfSpeech
      .map((t) => t.description)
      .join(", ");
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ["vscode-jisho.lookupText"] };
    const blocks = [
      `**${results[0].headword}**${reading === "" ? "" : ` ${reading}`}`,
      `${pos === "" ? "" : `*${pos}* — `}${glosses}`,
      ...(breakdown === null ? [] : [breakdown]),
      `[Open in Jisho](command:vscode-jisho.lookupText?${encodeURIComponent(JSON.stringify(results[0].headword))})`
    ];
    md.appendMarkdown(blocks.join("\n\n"));
    return new vscode.Hover(
      md,
      new vscode.Range(
        position.line,
        stripped.starts[wordStart],
        position.line,
        stripped.ends[wordStart + surface.length - 1]
      )
    );
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
    this.#view = view;
    this.#ready = false;
    view.onDidDispose(() => {
      this.#view = undefined;
      this.#ready = false;
    });
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.#context.extensionUri, "dist", "webview")
      ]
    };
    view.webview.html = this.#html(view.webview);
    view.webview.onDidReceiveMessage((msg: Request | WebviewReady) => {
      if (msg.type === "webviewReady") {
        this.#ready = true;
        for (const queued of this.#queuedPushes.splice(0)) {
          void view.webview.postMessage(queued);
        }
        return;
      }
      void this.#handle(view.webview, msg);
    });
  }

  async #handle(webview: vscode.Webview, request: Request): Promise<void> {
    try {
      const response =
        request.type === "getStrokeSvg"
          ? await this.#strokeSvg(request)
          : request.type === "searchNames" || request.type === "getName"
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

  /**
   * Stroke SVGs ship as files in the extension package, not in the dictionary DB — so they need no
   * database (the stroke page works even before the dictionary download finishes) and a stroke-data
   * fix never forces a dictionary re-download. See docs/STROKE-ORDER.md.
   */
  async #strokeSvg(request: GetStrokeSvgRequest): Promise<Response> {
    let svg: string | null = null;
    // The literal names a file, so insist on exactly one code point before touching the filesystem.
    if (Array.from(request.literal).length === 1) {
      try {
        const uri = vscode.Uri.joinPath(
          this.#context.extensionUri,
          "assets",
          "kanji-svgs",
          `${request.literal}.svg`
        );
        svg = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        svg = null; // no drawing exists for this character
      }
    }
    return { type: "getStrokeSvg", requestId: request.requestId, svg };
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

/** Requests served by the word/kanji dictionary (not the names DB, not the file-backed SVGs). */
type WordRequest = Exclude<
  Request,
  { type: "searchNames" } | { type: "getName" } | { type: "getStrokeSvg" }
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
