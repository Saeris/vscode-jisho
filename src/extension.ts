import * as vscode from "vscode";
import {
  checkForDictionaryUpdate,
  sweepDictionaryStorage
} from "./host/dictionaryUpdate";
import { targetWord, transformEditorText } from "./host/editorCommands";
import { addFurigana, removeFurigana } from "./host/furigana";
import { VIEW_ID, toggleHighlighting } from "./host/hostSettings";
import { beginTrace, endTrace, formatTrace, log } from "./host/log";
import { DECORATED_LANGUAGES, PosDecorator } from "./host/posDecorations";
import { addSpacing, removeSpacing } from "./host/spacing";
import { openIssueReport, showReportableError } from "./host/report";
import { configureTokenizer } from "./host/tokenizer";
import { JishoViewProvider } from "./host/webviewHost";
import type { HostPush } from "./shared/messages";

/**
 * Activation, wrapped.
 *
 * A throw here leaves VS Code showing its own "cannot activate" notice — generic, and with nothing
 * to click. It is also the worst case to be unreportable from: the extension is completely unusable,
 * there is no panel to report from, and every other pathway spec 20 built is unreachable. So this is
 * the one place a report is worth interrupting for.
 */
export function activate(context: vscode.ExtensionContext): void {
  try {
    activateJisho(context);
  } catch (err) {
    log().error(`activation failed: ${String(err)}`);
    void showReportableError(context, "Jisho failed to start.", err);
  }
}

function activateJisho(context: vscode.ExtensionContext): void {
  // The zero point for every duration below. Activation itself is cheap by design — the costly
  // resources load lazily — so this line plus the first "provision"/"open" timings show whether a
  // slow first search was the database, the tokenizer, or neither.
  beginTrace();
  log().info(
    `activating (${context.extensionMode === vscode.ExtensionMode.Development ? "development" : "production"})`
  );
  // Point the tokenizer at the compiled IPADIC dictionary bundled in the .vsix (loaded by path —
  // it isn't embedded in the native addon). Done eagerly at activation, NOT lazily on sidebar open:
  // the hover and the part-of-speech decorations tokenize on any markdown/plaintext file, which can
  // happen before the sidebar is ever opened. Cheap (just stores the path); the tokenizer still
  // builds lazily.
  configureTokenizer(
    vscode.Uri.joinPath(context.extensionUri, "assets", "lindera-ipadic").fsPath
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

  // Housekeeping off the activation tick, low priority: prune superseded/interrupted downloads from
  // globalStorage, then run the throttled, offline-safe dictionary-update check. Both are
  // fire-and-forget and never block activation (spec 05 §4–5).
  const housekeeping = setTimeout(() => {
    void (async (): Promise<void> => {
      await sweepDictionaryStorage(context);
      await checkForDictionaryUpdate(context, {
        manual: false,
        closeDatabases: async () => provider.closeDatabases()
      });
    })();
  }, 3000);
  housekeeping.unref();
  context.subscriptions.push({ dispose: () => clearTimeout(housekeeping) });
  // Part-of-speech colouring in the editor. Decorations rather than semantic tokens: only
  // decorations can carry our nine-category palette (see host/posDecorations.ts).
  const posDecorator = new PosDecorator();
  context.subscriptions.push(posDecorator);
  posDecorator.refreshAll();
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
    // The highlighting setting as a one-press toggle. It is the setting most worth flipping mid-task
    // — colour is help while you read a passage and noise while you edit it — and the Settings UI is
    // four actions away from a keyboard the user already has their hands on.
    vscode.commands.registerCommand(
      "vscode-jisho.toggleHighlighting",
      async () => {
        const enabled = await toggleHighlighting();
        // Confirmed in the status bar, not a notification: the result is often invisible (no
        // Japanese in the open file, or none on screen), so a toggle with no feedback reads as a
        // command that did nothing — but a modal-ish popup for a reversible display preference the
        // user may flip repeatedly would be worse than the silence.
        vscode.window.setStatusBarMessage(
          `Jisho: parts of speech highlighting ${enabled ? "on" : "off"}`,
          3000
        );
      }
    ),
    vscode.commands.registerCommand("vscode-jisho.openSettings", () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:saeris.vscode-jisho"
      );
    }),
    // Manual dictionary-update check: same path as the automatic one but ignores the 24h throttle
    // and reports "up to date" rather than staying silent.
    vscode.commands.registerCommand(
      "vscode-jisho.checkForDictionaryUpdates",
      async () =>
        checkForDictionaryUpdate(context, {
          manual: true,
          closeDatabases: async () => provider.closeDatabases()
        })
    ),
    // Feedback with the environment already filled in. The Marketplace's own "issues" link drops
    // the user on an empty form and asks them to reconstruct their versions from memory, which is
    // why most reports arrive unreproducible.
    vscode.commands.registerCommand("vscode-jisho.reportIssue", async () =>
      openIssueReport(context, {
        title: "",
        meta: await provider.dictionaryMeta()
      })
    ),
    // Live settings: re-push the snapshot whenever the user edits the Jisho section, and repaint
    // the editors (that's how the highlighting toggle and the palette choice apply live).
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("vscode-jisho")) {
        provider.pushSettings();
        posDecorator.onConfigurationChanged();
      }
    }),
    // Decorations are PUSHED, not requested, so we own invalidation. Four triggers cover it:
    // the text changed, a different editor became visible, the user scrolled to text we had not
    // painted yet, or a document was opened into an already-visible editor.
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!DECORATED_LANGUAGES.includes(event.document.languageId)) return;
      for (const editor of vscode.window.visibleTextEditors) {
        // Debounced: mid-word colouring is churn, and the pass is a tokenizer call per visible line.
        // The other three triggers stay immediate — see `refreshSoon`.
        if (editor.document === event.document)
          posDecorator.refreshSoon(editor);
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      posDecorator.refreshAll();
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      void posDecorator.refresh(event.textEditor);
    }),
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
