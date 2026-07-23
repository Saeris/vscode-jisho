import * as vscode from "vscode";
import { Dictionary } from "./host/db";
import { NamesDictionary } from "./host/names";
import { ensureDatabase, ensureNamesDatabase } from "./host/ensureDatabase";
import {
  groupSegments,
  japaneseRunAt,
  japaneseRuns,
  resolveWord,
  stripRuby,
  toStrippedIndex
} from "./host/hover";
import { provideHover } from "./host/hoverProvider";
import { addFurigana, removeFurigana } from "./host/furigana";
import {
  beginTrace,
  endTrace,
  formatTrace,
  log,
  mark,
  timed
} from "./host/log";
import { addSpacing, removeSpacing } from "./host/spacing";
import { contentSegmentCount, segment, warmTokenizer } from "./host/tokenizer";
import type {
  CopyTextRequest,
  GetStrokeSvgRequest,
  HostPush,
  HostSettings,
  OpenSettingsRequest,
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

/**
 * Whether grammar notes are shown. Read per hover rather than cached, so toggling the setting
 * applies to the next hover instead of requiring a reload — same discipline as `hover.enabled`.
 */
const grammarEnabled = (): boolean =>
  vscode.workspace
    .getConfiguration("vscode-jisho")
    .get<boolean>("grammar.enabled", true);

/** Snapshot of the webview-relevant settings, read fresh so edits apply without a reload. */
const currentSettings = (): HostSettings["settings"] => {
  const config = vscode.workspace.getConfiguration("vscode-jisho");
  return {
    textScale: config.get("appearance.textScale", 1.08),
    guideStyle: config.get("strokeOrder.guideStyle", "offset")
  };
};

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
const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(POS_TOKEN_TYPES);

/**
 * Color Japanese text by part of speech — a syntax highlighter for prose, so learners can see the
 * word boundaries spaces don't mark. Ruby-markup aware like the hover: a `{食|た}べる` group is
 * colored whole (braces and reading included) as its word.
 */
const provideSemanticTokens = async (
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
      if (!HAS_KANJI.test(run.text)) continue;
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

/**
 * The word the command should act on: the selection when there is one, otherwise the word under
 * the cursor — resolved through the same machinery as the hover, so "the word here" means the
 * same thing whether you hover it or right-click it. Returns the surface as written (speaking a
 * lemma would say a form the user didn't write) with the dictionary form alongside.
 */
const targetWord = async (): Promise<
  { surface: string; lookup: string } | undefined
> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const selected = editor.document.getText(editor.selection).trim();
  if (selected !== "") return { surface: selected, lookup: selected };

  const position = editor.selection.active;
  const stripped = stripRuby(editor.document.lineAt(position.line).text);
  const cursor = toStrippedIndex(stripped, position.character);
  const run = japaneseRunAt(stripped.text, cursor);
  if (run === null) return undefined;
  const groups = HAS_KANJI.test(run.text)
    ? groupSegments(await segment(run.text))
    : [];
  const { surface, lookup } = resolveWord(run, groups, cursor);
  return { surface, lookup };
};

/**
 * Apply a text transform to the selection (expanded to whole lines, so a partial-line selection
 * can't cut a word) or, with no selection, the whole document.
 */
const transformEditorText = async (
  transform: (text: string) => Promise<string>
): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const { document, selection } = editor;
  const range = selection.isEmpty
    ? new vscode.Range(
        0,
        0,
        document.lineCount - 1,
        document.lineAt(document.lineCount - 1).text.length
      )
    : new vscode.Range(
        selection.start.line,
        0,
        selection.end.line,
        document.lineAt(selection.end.line).text.length
      );
  const replaced = await transform(document.getText(range));
  await editor.edit((edit) => edit.replace(range, replaced));
};

export function activate(context: vscode.ExtensionContext): void {
  // The zero point for every duration below. Activation itself is cheap by design — the costly
  // resources load lazily — so this line plus the first "provision"/"open" timings show whether a
  // slow first search was the database, the tokenizer, or neither.
  beginTrace();
  log().info(
    `activating (${context.extensionMode === vscode.ExtensionMode.Development ? "development" : "production"})`
  );
  const provider = new JishoViewProvider(context);
  // Two warmups on different timers, because they cost differently.
  //
  // The dictionary is cheap (provision 16ms, open 6ms) and never blocks the thread, so it runs
  // almost immediately — just off the activation tick, where it would compete with the window
  // coming up. Opening it during the first search is what put a database open on that search's
  // critical path. The NAMES database stays lazy: it is the secondary result and plenty of users
  // never search it.
  const warmDb = setTimeout(() => void provider.warmDictionary(), 150);

  // Never hold the extension host open for speculative work.
  warmDb.unref();
  context.subscriptions.push({ dispose: () => clearTimeout(warmDb) });
  const semanticTokensChanged = new vscode.EventEmitter<void>();
  // Search wants the dictionary form (食べました → 食べる finds the entry); speech wants the form
  // as written, since reading back a lemma would say a word the user didn't write.
  const pushWord = (action: HostPush["action"]) => async (): Promise<void> => {
    const word = await targetWord();
    if (word === undefined) return;
    provider.push({
      type: "hostPush",
      action,
      text: action === "speak" ? word.surface : word.lookup
    });
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(
      "vscode-jisho.lookupSelection",
      pushWord("search")
    ),
    vscode.commands.registerCommand(
      "vscode-jisho.speakSelection",
      pushWord("speak")
    ),
    // Internal (not in contributes): the hover's "Open in Jisho" link runs this with its word.
    vscode.commands.registerCommand("vscode-jisho.lookupText", (text: string) =>
      provider.push({ type: "hostPush", action: "search", text })
    ),
    // 分かち書き: learner word-spacing as a deterministic transform (BACKLOG #38).
    vscode.commands.registerCommand("vscode-jisho.addSpacing", async () =>
      transformEditorText(addSpacing)
    ),
    vscode.commands.registerCommand("vscode-jisho.removeSpacing", async () =>
      transformEditorText(removeSpacing)
    ),
    // Furigana annotation in mirrordown ruby syntax (BACKLOG #33).
    vscode.commands.registerCommand("vscode-jisho.addFurigana", async () =>
      transformEditorText(addFurigana)
    ),
    vscode.commands.registerCommand("vscode-jisho.removeFurigana", async () =>
      transformEditorText(removeFurigana)
    ),
    // Startup diagnostics: dumps the wall-clock timeline (including the GAPS between steps) so a
    // slow session can be reported as data rather than "it felt slow".
    vscode.commands.registerCommand(
      "vscode-jisho.showStartupTrace",
      async () => {
        const doc = await vscode.workspace.openTextDocument({
          content: formatTrace(),
          language: "plaintext"
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    ),
    vscode.commands.registerCommand("vscode-jisho.openSettings", () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:saeris.vscode-jisho"
      );
    }),
    // Live settings: re-push the snapshot whenever the user edits the Jisho section, and have
    // open editors re-request semantic tokens (that's how the highlighting toggle applies live).
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("vscode-jisho")) {
        provider.pushSettings();
        semanticTokensChanged.fire();
      }
    }),
    semanticTokensChanged,
    vscode.languages.registerDocumentSemanticTokensProvider(
      ["markdown", "plaintext"],
      {
        onDidChangeSemanticTokens: semanticTokensChanged.event,
        provideDocumentSemanticTokens: provideSemanticTokens
      },
      SEMANTIC_LEGEND
    ),
    vscode.languages.registerHoverProvider(["markdown", "plaintext"], {
      provideHover: async (document, position, token) =>
        provider.hover(document, position, token)
    }),
    provider
  );
}

export function deactivate(): void {
  endTrace();
}

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
    // Two reasons it hangs off this event. First, `activationEvents` is empty: the hover and
    // semantic-token providers mean the extension activates on ANY markdown or plaintext file, and
    // a 197ms blocking build is not something to inflict on someone who just opened a README.
    // Opening the sidebar is the signal that someone intends to search. Second, timing — the panel
    // reaches "webview ready" around 320ms, and a trace caught a search at 1777ms beating a
    // 2000ms warmup, which then stalled the thread twice AFTER the results. Starting here puts the
    // build in the window where the user is still looking at an empty panel.
    //
    // The build itself cannot be improved from our side: a 5ms heartbeat gets ZERO ticks across
    // `build()`, so it is one uninterruptible WASM call. All we control is when it lands.
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

/** The sidebar's ⚙: open VS Code's Settings UI filtered to this extension's section. */
const openSettings = (request: OpenSettingsRequest): Response => {
  void vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "@ext:saeris.vscode-jisho"
  );
  return { type: "openSettings", requestId: request.requestId };
};

/** Copy-as: the host owns the clipboard, since the webview's needs user activation. */
const copyText = async (request: CopyTextRequest): Promise<Response> => {
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
