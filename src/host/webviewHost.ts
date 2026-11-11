/**
 * The sidebar webview host: serves the React app, bridges its messages to the dictionaries, and owns
 * the lazily-opened database handles.
 *
 * Split out of extension.ts so that file is activation wiring only. Everything stateful about a
 * running session lives here — which view is attached, whether its bridge has said hello, which
 * request kinds have been traced, and the two open-once-retry-on-failure database promises.
 */
import { rename } from "node:fs/promises";
import * as vscode from "vscode";
import type { Dictionary } from "./db";
import { webviewHtml } from "./webviewHtml";
import {
  answer,
  copyText,
  namesHandlers,
  openSettings,
  wordHandlers
} from "./dispatch";
import { openIssueReport } from "./report";
import { collectDiagnostics } from "./diagnostics";
import { diagnosticsMarkdown } from "../shared/diagnostics";
import {
  ensureDatabase,
  ensureNamesDatabase,
  namesDatabaseExists,
  wordDatabaseExists
} from "./ensureDatabase";
import { classifyFailure } from "./failure";
import { DictionaryError, DictionaryLifecycle } from "./lifecycle";
import { openRemote, type Remote } from "./remote";
import { provideHover } from "./hoverProvider";
import type { CommentScopes } from "./grammar";
import { mark, timed } from "./log";
import type { NamesDictionary } from "./names";
import { clearRecent, readRecent, recordRecent } from "./recentSearches";
import { segment, warmTokenizer } from "./tokenizer";
import { CLASSIFIER_BY_ID } from "../shared/classifiers";
import { lazy } from "../shared/lazy";
import {
  regionalDrawings,
  type DrawingSet,
  type StrokeManifest
} from "./regionalStrokes";
import type {
  Answer,
  DictionaryStatusPush,
  Handlers,
  HostPush,
  HostSettings,
  Request,
  RequestOf,
  Response,
  WebviewReady
} from "../shared/messages";
import {
  codeCommentsEnabled,
  currentSettings,
  grammarEnabled,
  isProse,
  VIEW_ID
} from "./hostSettings";

/** Editor commands held for a panel that has not opened yet. More than this is a backlog, not intent. */
const MAX_QUEUED_PUSHES = 20;

/** `globalState` key: the user answered the names offer with "No thanks". */
const NAMES_DECLINED_KEY = "names.offerDeclined";

/**
 * A browse request for a NAME type, which the separate names dictionary serves.
 *
 * Every other classifier is answered from the word DB, so this is the one branch of `browse` that
 * needs a different backend — routed here rather than in `dispatch.ts`, which has no names handle.
 */
const isNameBrowse = (request: RequestOf<"browse">): boolean => {
  const classifier = CLASSIFIER_BY_ID.get(request.id);
  return (
    classifier?.kind === "result" &&
    (classifier.result === "name" || classifier.result === "place")
  );
};

/**
 * Serves the React webview into the sidebar and bridges its messages to the dictionary. The DB is
 * opened lazily on first message so activation stays fast and any provisioning error surfaces in
 * the UI rather than crashing activation.
 */
export class JishoViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  #context: vscode.ExtensionContext;
  /** The word dictionary's lifecycle — provisioning, opening, updating, failing. See lifecycle.ts. */
  readonly #words: DictionaryLifecycle<Remote<Dictionary>>;
  /** The names dictionary's. Opt-in: only `installNames` provisions it. */
  readonly #names: DictionaryLifecycle<Remote<NamesDictionary>>;
  #view: vscode.WebviewView | undefined;
  /** Set when the webview's bridge has said `webviewReady` — messages before that would be lost. */
  #ready = false;
  /**
   * Messages waiting for a webview that can receive them, in order.
   *
   * A webview receives nothing before its bridge is ready, and — now that the sidebar keeps its
   * context when hidden — nothing while it is hidden either: "You cannot send messages to a hidden
   * webview, even with `retainContextWhenHidden`" (the VS Code typings). A response posted then was
   * simply lost, and the request it answered stayed pending in the webview for good. Everything goes
   * through `#post`, which delivers now or queues until the view is ready and visible.
   */
  #outbox: Array<Response | HostPush> = [];
  /**
   * The latest settings and dictionary status, kept apart from the outbox because only the newest of
   * each matters: a webview that was hidden through three status changes needs the fourth, not all.
   */
  #latest = new Map<
    "hostSettings" | "dictionaryStatus",
    HostSettings | DictionaryStatusPush
  >();
  /** Request kinds already served, so the trace times each kind's FIRST (cold) round trip. */
  #seen = new Set<Request["type"]>();
  /** Set once the tokenizer warmup has been scheduled, so re-revealing the view doesn't re-arm it. */
  #warmedTokenizer = false;
  /** One handler per request type, checked against the protocol — see `#buildHandlers`. */
  readonly #handlers: Handlers;

  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
    const onStatus = (): void => this.#pushStatus();
    // Both dictionaries run in worker threads: `node:sqlite` is synchronous, and this thread is
    // shared by every installed extension (see dictionaryWorker.ts).
    const worker = vscode.Uri.joinPath(
      context.extensionUri,
      "dist",
      "dictionaryWorker.cjs"
    ).fsPath;
    this.#words = new DictionaryLifecycle<Remote<Dictionary>>({
      exists: async (): Promise<boolean> => wordDatabaseExists(context),
      // Timed separately: provisioning (a link, a copy or a download) and opening fail and stall for
      // completely different reasons, and "the first search was slow" needs to say which.
      provision: async (onProgress): Promise<string> =>
        timed("provision dictionary", async () =>
          ensureDatabase(context, onProgress)
        ),
      open: async (path): Promise<Remote<Dictionary>> =>
        timed("open dictionary", async () => {
          // If this worker dies, the next request opens a new one.
          const words: Remote<Dictionary> = await openRemote<Dictionary>(
            worker,
            "words",
            path,
            () => this.#words.lost(words)
          );
          return words;
        }),
      rename,
      classify: classifyFailure,
      onStatus
    });
    this.#names = new DictionaryLifecycle<Remote<NamesDictionary>>({
      exists: async (): Promise<boolean> => namesDatabaseExists(context),
      provision: async (onProgress): Promise<string> =>
        timed("provision names dictionary", async () =>
          ensureNamesDatabase(context, onProgress)
        ),
      open: async (path): Promise<Remote<NamesDictionary>> =>
        timed("open names dictionary", async () => {
          const names: Remote<NamesDictionary> =
            await openRemote<NamesDictionary>(worker, "names", path, () =>
              this.#names.lost(names)
            );
          return names;
        }),
      rename,
      classify: classifyFailure,
      onStatus
    });
    this.#handlers = this.#buildHandlers();
  }

  /** Both dictionaries, for the update to swap in place. */
  get dictionaries(): {
    words: DictionaryLifecycle<Remote<Dictionary>>;
    names: DictionaryLifecycle<Remote<NamesDictionary>>;
  } {
    return { words: this.#words, names: this.#names };
  }

  /**
   * Deliver a message now if the webview can receive it, otherwise when it can.
   *
   * Settings and status are coalesced (only the newest matters); everything else keeps its order.
   */
  #post(
    message: Response | HostPush | HostSettings | DictionaryStatusPush
  ): void {
    if (
      message.type === "hostSettings" ||
      message.type === "dictionaryStatus"
    ) {
      this.#latest.set(message.type, message);
    } else {
      this.#outbox.push(message);
      // Editor commands issued against a panel that never opens must not accumulate forever.
      const pushes = this.#outbox.filter((m) => m.type === "hostPush");
      if (pushes.length > MAX_QUEUED_PUSHES) {
        const oldest = pushes[0];
        this.#outbox.splice(this.#outbox.indexOf(oldest), 1);
      }
    }
    this.#flush();
  }

  /** Send everything waiting, if the view is ready and visible. Settings first, so the panel is
   *  styled before anything lands in it. */
  #flush(): void {
    const view = this.#view;
    if (!view || !this.#ready || !view.visible) return;
    for (const message of this.#latest.values())
      void view.webview.postMessage(message);
    this.#latest.clear();
    for (const message of this.#outbox.splice(0))
      void view.webview.postMessage(message);
  }

  #pushStatus(): void {
    this.#post({
      type: "dictionaryStatus",
      words: this.#words.status,
      names: this.#names.status
    });
  }

  /**
   * Deliver an editor-command push, revealing the sidebar. It is held until the webview can receive
   * it, so a command issued before the panel ever opened — or while it was hidden — still lands.
   */
  push(message: HostPush): void {
    // The `<viewId>.focus` command is auto-registered by VS Code; it opens and reveals the view,
    // triggering resolveWebviewView when needed.
    void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    this.#post(message);
  }

  /** Push the current settings snapshot (delivered as soon as the webview can receive it). */
  pushSettings(): void {
    this.#post({ type: "hostSettings", settings: currentSettings() });
  }

  /**
   * Dictionary hover for Japanese text (BACKLOG #33). Orchestration lives in
   * `host/hoverProvider.ts`; this method just injects the vscode-facing dependencies (settings, the
   * lazily-opened dictionary, the tokenizer).
   */
  async hover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    scopes?: CommentScopes
  ): Promise<vscode.Hover | undefined> {
    // In a CODE file, answer only inside a comment. Two gates, and both matter: the setting is
    // opt-in, and the grammar decides what a comment is — so a string literal or an identifier
    // never gets a dictionary hover, and TypeScript's own hover is never competed with there.
    if (!isProse(document.languageId)) {
      if (!codeCommentsEnabled()) return undefined;
      if (!scopes) return undefined;
      if (!(await scopes.isComment(document, position))) return undefined;
      if (token.isCancellationRequested) return undefined;
    }
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
   * Provision and open the word dictionary ahead of the first query. Fire-and-forget: the lifecycle
   * shares one attempt, so a search arriving mid-warm joins it rather than starting a second, and a
   * failure is recorded in its state — which the panel shows — rather than lost.
   */
  async warmDictionary(): Promise<void> {
    try {
      await this.#words.acquire();
    } catch {
      // Speculative work has no caller to report to. `not-ready` (a first-run download) and any
      // failure are both visible in the dictionary's status, which the panel already shows.
    }
  }

  /**
   * The dictionary's own metadata for a crash report, or `undefined` when it cannot be read.
   *
   * Never throws, deliberately. This is called while filing a report — often BECAUSE something is
   * broken, and a failure to open the dictionary is exactly the kind of bug being reported. A
   * reporter that threw here would fail precisely when it is most needed, so an unreadable
   * dictionary degrades to "unknown" rows in the table rather than to no report at all.
   */
  async dictionaryMeta(): Promise<Record<string, string> | undefined> {
    try {
      return await (await this.#dict()).getMeta();
    } catch {
      return undefined;
    }
  }

  async #dict(): Promise<Remote<Dictionary>> {
    return this.#words.acquire();
  }

  /**
   * The names dictionary, PROVISIONING it if absent — which downloads it, waiting through it.
   *
   * Only `installNames` may call this: names are opt-in. Everything that merely reads names goes
   * through `#installedNames()`, which never downloads. Names used to be provisioned by the first
   * search of anything, because every search also searched names (audit I-0); the webview no longer
   * asks before they are installed, and this split enforces the same rule here, where a stale
   * document or a race could still send a names request.
   */
  async #namesDict(): Promise<Remote<NamesDictionary>> {
    return this.#names.install();
  }

  /** The names dictionary if it is installed (or being opened), else `undefined`. Never downloads. */
  async #installedNames(): Promise<Remote<NamesDictionary> | undefined> {
    return this.#names.acquireIfInstalled();
  }

  /** Whether to offer the names dictionary: not installed, and not declined. */
  #namesOffered(available: boolean): boolean {
    return (
      !available &&
      !this.#context.globalState.get<boolean>(NAMES_DECLINED_KEY, false)
    );
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
      // Only if it is still THIS view: an old view's dispose arriving after a new one resolved used
      // to clear the new one (audit SM-2).
      if (this.#view !== view) return;
      this.#view = undefined;
      this.#ready = false;
    });
    // The sidebar keeps its context when hidden, but a hidden webview cannot receive messages, so
    // anything that arrived meanwhile is delivered when it is shown again.
    view.onDidChangeVisibility(() => this.#flush());
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.#context.extensionUri, "dist", "webview")
      ]
    };
    view.webview.html = webviewHtml(view.webview, this.#context.extensionUri);
    view.webview.onDidReceiveMessage((msg: Request | WebviewReady) => {
      if (msg.type === "webviewReady") {
        // The React app has booted and attached its bridge. The gap from "sidebar opened" to here
        // is webview bundle load + React mount — the one segment that is NOT extension-host work.
        mark("webview ready");
        this.#ready = true;
        // A new document knows nothing yet: give it the current settings and dictionary status,
        // then everything that waited for it.
        this.pushSettings();
        this.#pushStatus();
        return;
      }
      void this.#handle(view, msg);
    });
  }

  async #handle(view: vscode.WebviewView, request: Request): Promise<void> {
    // Time the FIRST request of each kind end-to-end. That is the number the user actually feels
    // ("terms are searchable"), and it spans lazy DB provisioning + open + tokenizer + query —
    // costs that no single inner measurement covers on its own.
    const first = !this.#seen.has(request.type);
    if (first) this.#seen.add(request.type);
    try {
      const response = first
        ? await timed(`first "${request.type}" request`, async () =>
            answer(this.#handlers, request)
          )
        : await answer(this.#handlers, request);
      this.#reply(view, response);
    } catch (err) {
      this.#reply(view, {
        type: "error",
        requestId: request.requestId,
        message: err instanceof Error ? err.message : String(err),
        // The dictionary's STATE (still downloading, offline, the wrong schema) rather than a bug,
        // so the panel can offer the recovery that fits instead of a report.
        ...(err instanceof DictionaryError ? { code: err.code } : {})
      });
    }
  }

  /**
   * Answer a request — through the outbox, so an answer that is ready while the view is hidden is
   * delivered when it is shown, instead of being lost and leaving the request pending forever.
   *
   * Dropped if the view that asked has since been replaced: its document, and the request it was
   * waiting on, are gone.
   */
  #reply(view: vscode.WebviewView, response: Response): void {
    if (this.#view === view) this.#post(response);
  }

  /**
   * Browse a name type (`#name`/`#place`).
   *
   * Served here rather than in `dispatch.ts` because it needs the NAMES dictionary, which is a
   * separate opt-in download — the same reason `searchNames` is routed here. Opening one of these
   * lists never provisions it: the tags are hidden until it is installed, and an empty list is the
   * honest answer if one is reached anyway.
   */
  async #browseNames(request: RequestOf<"browse">): Promise<Answer<"browse">> {
    const classifier = CLASSIFIER_BY_ID.get(request.id);
    const kind =
      classifier?.kind === "result" && classifier.result === "place"
        ? "place"
        : "name";
    const names = await this.#installedNames();
    return {
      results: [],
      kanji: [],
      names: names ? await names.browseNames(kind) : [],
      total: names ? await names.browseNamesCount(kind) : 0
    };
  }

  /**
   * Counts for the name types, which the WORD dictionary cannot produce.
   *
   * Only when the names DB is installed — a count is never a reason to download it. When it is absent
   * the counts stay 0 and the tags stay hidden, which is the correct answer then.
   */
  async #nameCounts(): Promise<Record<string, number>> {
    const names = await this.#installedNames();
    if (!names) return {};
    return {
      name: await names.browseNamesCount("name"),
      place: await names.browseNamesCount("place")
    };
  }

  /**
   * The answer to every request the webview can make, one handler each.
   *
   * Typed `Handlers`, so a request type added to the protocol without a handler here does not
   * compile, and neither does a handler that answers in another request's shape. The word and names
   * dictionaries' handlers live in `dispatch.ts`; the ones here need the extension context.
   */
  #buildHandlers(): Handlers {
    const context = this.#context;
    const words = wordHandlers({
      dict: async () => this.#dict(),
      names: async () => {
        const available = await namesDatabaseExists(context);
        return { available, offered: this.#namesOffered(available) };
      },
      nameCounts: async () => this.#nameCounts()
    });
    // Recent-search history is backed by `globalState`, not by a dictionary. All three requests
    // answer with the full list, so a record or a clear needs no follow-up fetch.
    const recent = (): Answer<"getRecentSearches"> => ({
      recent: readRecent(context)
    });
    return {
      ...words,
      ...namesHandlers(async () => this.#installedNames()),
      // Name types live in the names dictionary, which the word handlers do not have.
      browse: async (request) =>
        isNameBrowse(request)
          ? this.#browseNames(request)
          : words.browse(request),
      getStrokeSvg: async (request) => this.#strokeSvg(request),
      getRegionalStrokes: async (request) => this.#regionalStrokes(request),
      openSettings,
      copyText,
      reportCrash: async ({ message, stack }) => {
        await openIssueReport(context, {
          title: `Crash: ${message}`,
          error: { message, stack: stack ?? "" },
          meta: await this.dictionaryMeta()
        });
        return {};
      },
      getDiagnostics: async () => ({
        markdown: diagnosticsMarkdown(
          await collectDiagnostics(context, await this.dictionaryMeta())
        )
      }),
      installNames: async () => {
        // The user accepted: provision it (with VS Code's progress notice), and clear any earlier
        // "No thanks" so the decision on record is the latest one.
        await this.#namesDict();
        await context.globalState.update(NAMES_DECLINED_KEY, undefined);
        return {};
      },
      declineNames: async () => {
        await context.globalState.update(NAMES_DECLINED_KEY, true);
        return {};
      },
      dictionaryAction: async ({ action }) => {
        if (action === "retry") {
          // A fresh attempt; its progress and outcome reach the panel as status.
          void this.warmDictionary();
        } else if (action === "update") {
          await vscode.commands.executeCommand(
            "vscode-jisho.checkForDictionaryUpdates"
          );
        } else {
          await vscode.commands.executeCommand(
            "extension.open",
            context.extension.id
          );
        }
        return {};
      },
      getRecentSearches: async () => Promise.resolve(recent()),
      recordRecentSearch: async ({ query, headword }) => {
        await recordRecent(context, { query, headword });
        return recent();
      },
      clearRecentSearches: async () => {
        await clearRecent(context);
        return recent();
      }
    };
  }

  /**
   * Stroke SVGs ship as files in the extension package, not in the dictionary DB — so they need no
   * database (the stroke page works even before the dictionary download finishes) and a stroke-data
   * fix never forces a dictionary re-download. See docs/STROKE-ORDER.md.
   */
  async #strokeSvg(
    request: RequestOf<"getStrokeSvg">
  ): Promise<Answer<"getStrokeSvg">> {
    // Two directories because the two sets carry different licences (Arphic PL vs LGPL — see
    // build-strokes.ts). A literal belongs to exactly one of them, so trying both in turn keeps
    // that split invisible to callers rather than making every caller classify the character.
    return {
      svg: await this.#readDrawing(["kanji-svgs", "kana-svgs"], request.literal)
    };
  }

  /** One drawing from the first of `dirs` (under `assets/`) that has it, or null. */
  async #readDrawing(
    dirs: readonly string[],
    char: string
  ): Promise<string | null> {
    // Only the unified drawing ships (its compat twin would collide on a normalizing filesystem —
    // see build-strokes.ts), so fold compat codepoints onto it rather than 404 the 37 Kanjidic
    // literals that use them.
    const literal = char.normalize("NFC");
    // The literal names a file, so insist on exactly one code point before touching the filesystem.
    if (Array.from(literal).length !== 1) return null;
    // TWO candidate names, because the drawings are stored under different names in the two places
    // this code runs:
    //
    //  - In the repo (F5 development) they keep their readable literal names — `水.svg` is what a
    //    contributor greps for.
    //  - In the .vsix they are renamed to their decimal codepoint by package-platforms.ts, because
    //    the Marketplace rejected non-ASCII entry names as duplicate dictionary keys.
    //
    // Codepoint first: that is what ships, so the packaged extension finds its file on the first
    // try and the literal is only reached during development.
    const names = [`${literal.codePointAt(0)}.svg`, `${literal}.svg`];
    for (const dir of dirs)
      for (const name of names) {
        try {
          const uri = vscode.Uri.joinPath(
            this.#context.extensionUri,
            "assets",
            dir,
            name
          );
          return new TextDecoder().decode(
            await vscode.workspace.fs.readFile(uri)
          );
        } catch {
          // not in this set; try the next
        }
      }
    return null;
  }

  /**
   * Which set draws China's and Taiwan's forms (spec 22, phase 4), read once. It ships beside the
   * drawings it describes, so the two cannot disagree. A failed read is kept: the file is part of
   * the package, and a package without it will not grow one.
   */
  readonly #strokeManifest = lazy(
    async (): Promise<StrokeManifest> => {
      const uri = vscode.Uri.joinPath(
        this.#context.extensionUri,
        "assets",
        "regional-strokes.json"
      );
      const manifest: StrokeManifest = JSON.parse(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
      );
      return manifest;
    },
    { onFailure: "keep" }
  );

  /** Stroke order by region: the drawings of the kanji's own regional group, Japan's first. */
  async #regionalStrokes(
    request: RequestOf<"getRegionalStrokes">
  ): Promise<Answer<"getRegionalStrokes">> {
    const group = (
      await (await this.#dict()).getRegionalForms(request.literal)
    ).at(0);
    if (group === undefined) return { drawings: [] };
    const dirs: Record<DrawingSet, string> = {
      ja: "kanji-svgs",
      hans: "hans-svgs",
      hant: "hant-svgs"
    };
    return {
      drawings: await regionalDrawings(
        group,
        await this.#strokeManifest.get(),
        async ({ set, char }) => this.#readDrawing([dirs[set]], char)
      )
    };
  }

  async dispose(): Promise<void> {
    for (const lifecycle of [this.#words, this.#names]) {
      try {
        await lifecycle.close();
      } catch {
        // best-effort close on shutdown
      }
    }
  }
}
