/**
 * The sidebar webview host: serves the React app, bridges its messages to the dictionaries, and owns
 * the lazily-opened database handles.
 *
 * Split out of extension.ts so that file is activation wiring only. Everything stateful about a
 * running session lives here — which view is attached, whether its bridge has said hello, which
 * request kinds have been traced, and the two open-once-retry-on-failure database promises.
 */
import * as vscode from "vscode";
import { Dictionary } from "./db";
import { copyText, openSettings, respond, respondNames } from "./dispatch";
import { ensureDatabase, ensureNamesDatabase } from "./ensureDatabase";
import { provideHover } from "./hoverProvider";
import { mark, timed } from "./log";
import { NamesDictionary } from "./names";
import { segment, warmTokenizer } from "./tokenizer";
import type {
  GetStrokeSvgRequest,
  HostPush,
  HostSettings,
  Request,
  Response,
  WebviewReady
} from "../shared/messages";
import { currentSettings, grammarEnabled, VIEW_ID } from "./hostSettings";

/**
 * Serves the React webview into the sidebar and bridges its messages to the dictionary. The DB is
 * opened lazily on first message so activation stays fast and any provisioning error surfaces in
 * the UI rather than crashing activation.
 */
export class JishoViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  #context: vscode.ExtensionContext;
  #dictionary: Promise<Dictionary> | undefined;
  #names: Promise<NamesDictionary> | undefined;
  #view: vscode.WebviewView | undefined;
  /** Set when the webview's bridge has said `webviewReady` — pushes before that would be lost. */
  #ready = false;
  #queuedPushes: HostPush[] = [];
  /** Request kinds already served, so the trace times each kind's FIRST (cold) round trip. */
  #seen = new Set<Request["type"]>();
  /** Set once the tokenizer warmup has been scheduled, so re-revealing the view doesn't re-arm it. */
  #warmedTokenizer = false;

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

  /** Push the current settings snapshot to a live webview (no-op until webviewReady). */
  pushSettings(): void {
    if (this.#ready && this.#view) {
      const message: HostSettings = {
        type: "hostSettings",
        settings: currentSettings()
      };
      void this.#view.webview.postMessage(message);
    }
  }

  /**
   * Dictionary hover for Japanese text (BACKLOG #33). Orchestration lives in
   * `host/hoverProvider.ts`; this method just injects the vscode-facing dependencies (settings, the
   * lazily-opened dictionary, the tokenizer).
   */
  async hover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    return provideHover(document, position, token, {
      hoverEnabled: () =>
        vscode.workspace
          .getConfiguration("vscode-jisho")
          .get<boolean>("hover.enabled", true),
      grammarEnabled,
      segment,
      search: async (lookup, limit) =>
        (await this.#dict()).search(lookup, limit),
      resolveByLemma: async (lemma, pos, reading) =>
        (await this.#dict()).resolveByLemma(lemma, pos, reading),
      getWord: async (id) => (await this.#dict()).getWord(id)
    });
  }

  /**
   * Kick off the tokenizer build once per session, shortly after the sidebar first opens.
   *
   * Guarded because `resolveWebviewView` runs again whenever the view is re-created (collapse and
   * expand the sidebar, or move it between containers) — `warmTokenizer` is itself idempotent, but
   * re-arming the timer on every reveal would keep scheduling work that has long since finished.
   */
  #warmTokenizerOnce(): void {
    if (this.#warmedTokenizer) return;
    this.#warmedTokenizer = true;
    // (The dictionary path is configured eagerly in `activate()`, so it's ready before any hover or
    // semantic-token tokenization that may precede the sidebar being opened.)
    // A short delay so the build lands after the webview's own bundle has loaded and rendered,
    // rather than competing with it for the same thread.
    const timer = setTimeout(
      () => void timed("warm tokenizer", warmTokenizer),
      300
    );
    timer.unref();
    this.#context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }

  /**
   * Provision and open the word dictionary ahead of the first query. Fire-and-forget: `#dict()`
   * caches the same promise, so a search arriving mid-warm awaits the in-flight open rather than
   * starting a second one, and a failure here is re-thrown where a user is actually waiting.
   */
  async warmDictionary(): Promise<void> {
    try {
      await this.#dict();
    } catch {
      // Speculative work has no caller to report to; #dict() clears its cache so the real request
      // retries and surfaces the error in the UI.
    }
  }

  async #dict(): Promise<Dictionary> {
    // Open once, reuse. If opening fails, clear the cache so a later message can retry.
    this.#dictionary ??= (async (): Promise<Dictionary> => {
      try {
        // Timed separately: provisioning (a copy, or a download) and opening fail and stall for
        // completely different reasons, and "the first search was slow" needs to say which.
        const path = await timed("provision dictionary", async () =>
          ensureDatabase(this.#context)
        );
        return await timed("open dictionary", async () =>
          Dictionary.open(path)
        );
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
        const path = await timed("provision names dictionary", async () =>
          ensureNamesDatabase(this.#context)
        );
        return await timed("open names dictionary", async () =>
          NamesDictionary.open(path)
        );
      } catch (err) {
        this.#names = undefined;
        throw err;
      }
    })();
    return this.#names;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    // The sidebar was opened — this is when the extension becomes user-visible, and the gap from
    // activation to here is host/UI time rather than ours.
    mark("sidebar opened");
    // Build the tokenizer now, tied to the sidebar rather than to activation.
    //
    // It hangs off this event rather than activation because `activationEvents` is empty: the hover
    // and semantic-token providers activate the extension on ANY markdown or plaintext file, and
    // opening the sidebar is the signal that someone actually intends to search.
    //
    // The cost that justified this scheduling has largely gone. Measured 2026-07-29 the build is
    // ~27ms, not the 197ms recorded when it was a WASM call — the native lindera-nodejs binding is
    // ~7x cheaper, and a cold `segment()` with no warm at all costs 24ms. So the elaborate part of
    // this (a deferred timer, tied to sidebar reveal) is now over-engineered for what it defers.
    // Left in place because it is harmless and correct; simplify it deliberately, not incidentally.
    this.#warmTokenizerOnce();
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
        // The React app has booted and attached its bridge. The gap from "sidebar opened" to here
        // is webview bundle load + React mount — the one segment that is NOT extension-host work.
        mark("webview ready");
        this.#ready = true;
        // Settings first, so the panel is styled before any queued command lands.
        this.pushSettings();
        for (const queued of this.#queuedPushes.splice(0)) {
          void view.webview.postMessage(queued);
        }
        return;
      }
      void this.#handle(view.webview, msg);
    });
  }

  async #handle(webview: vscode.Webview, request: Request): Promise<void> {
    // Time the FIRST request of each kind end-to-end. That is the number the user actually feels
    // ("terms are searchable"), and it spans lazy DB provisioning + open + tokenizer + query —
    // costs that no single inner measurement covers on its own.
    const first = !this.#seen.has(request.type);
    if (first) this.#seen.add(request.type);
    try {
      const response = first
        ? await timed(`first "${request.type}" request`, async () =>
            this.#dispatch(request)
          )
        : await this.#dispatch(request);
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

  /** Route a request to whichever backend serves it. */
  async #dispatch(request: Request): Promise<Response> {
    return request.type === "openSettings"
      ? openSettings(request)
      : request.type === "copyText"
        ? copyText(request)
        : request.type === "getStrokeSvg"
          ? this.#strokeSvg(request)
          : request.type === "searchNames" || request.type === "getName"
            ? respondNames(await this.#namesDict(), request)
            : respond(await this.#dict(), request);
  }

  /**
   * Stroke SVGs ship as files in the extension package, not in the dictionary DB — so they need no
   * database (the stroke page works even before the dictionary download finishes) and a stroke-data
   * fix never forces a dictionary re-download. See docs/STROKE-ORDER.md.
   */
  async #strokeSvg(request: GetStrokeSvgRequest): Promise<Response> {
    let svg: string | null = null;
    // Only the unified drawing ships (its compat twin would collide on a normalizing filesystem —
    // see build-strokes.ts), so fold compat codepoints onto it rather than 404 the 37 Kanjidic
    // literals that use them.
    const literal = request.literal.normalize("NFC");
    // The literal names a file, so insist on exactly one code point before touching the filesystem.
    if (Array.from(literal).length === 1) {
      try {
        const uri = vscode.Uri.joinPath(
          this.#context.extensionUri,
          "assets",
          "kanji-svgs",
          `${literal}.svg`
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

const makeNonce = (): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++)
    nonce += chars[Math.floor(Math.random() * chars.length)];
  return nonce;
};
