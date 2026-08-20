/**
 * The view id and the settings readers, shared by activation and the webview host.
 *
 * Both readers deliberately read configuration on EVERY call rather than caching: an edit in the
 * Settings UI then applies to the next hover or the next snapshot push, instead of requiring a
 * window reload.
 */
import * as vscode from "vscode";
import type { HostSettings } from "../shared/messages";

export const VIEW_ID = "vscode-jisho.searchView";

/**
 * Languages that are prose end to end, where every line is the subject.
 *
 * Everything else is a CODE file: covered only inside its comments, and only when a grammar can be
 * resolved for it (spec 18). The distinction is what stops a Japanese identifier or a string
 * literal being treated as prose.
 */
export const PROSE_LANGUAGES = ["markdown", "plaintext"];

/**
 * Code languages whose comments the editor features cover.
 *
 * An explicit list rather than "every language with a grammar", which would be a one-word change.
 * Each entry has been VERIFIED against the grammar VS Code ships — line comments, block comments
 * spanning lines, and string literals correctly left alone. Python needed a widened scope predicate
 * to cover docstrings, which is exactly the kind of per-language surprise a blanket opt-in would
 * have shipped unnoticed. Adding a language is cheap; adding it untested is not.
 */
export const CODE_LANGUAGES = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "html",
  "css",
  "python",
  "php",
  "rust"
];

/**
 * Every language the editor features look at, prose and code together.
 *
 * Shared by the hover and the decorator so a language cannot be covered by one and not the other —
 * they were separate lists until the hover was added, and the hover simply did not apply in code
 * files at all.
 */
export const SUPPORTED_LANGUAGES = [...PROSE_LANGUAGES, ...CODE_LANGUAGES];

/** Whether a document is prose, where the whole line is the subject rather than its comments. */
export const isProse = (languageId: string): boolean =>
  PROSE_LANGUAGES.includes(languageId);

/**
 * Whether the editor features extend into CODE COMMENTS. Off by default.
 *
 * One setting for both the hover and the colouring, deliberately. They answer the same question —
 * "is this Japanese meant for a human reader" — through the same grammar, and a user who wants one
 * in their source files wants the other. Two settings would mean explaining a difference that does
 * not exist.
 */
export const codeCommentsEnabled = (): boolean =>
  vscode.workspace
    .getConfiguration("vscode-jisho")
    .get<boolean>("highlighting.codeComments", false);

/**
 * Whether grammar notes are shown. Read per hover rather than cached, so toggling the setting
 * applies to the next hover instead of requiring a reload — same discipline as `hover.enabled`.
 */
export const grammarEnabled = (): boolean =>
  vscode.workspace
    .getConfiguration("vscode-jisho")
    .get<boolean>("grammar.enabled", true);

/**
 * Flip one boolean setting, and say which way it went.
 *
 * Writes back to the scope the value CAME from. `inspect` is what makes that possible: a user who
 * turned a setting on for one Japanese-notes workspace expects the toggle to flip that workspace,
 * not to write a global they never set — and a global write would leave the workspace value still
 * in force, so the command would appear to do nothing at all.
 *
 * Falls back to Global when nothing is set anywhere, which is the first press on a fresh install.
 */
const toggleBoolean = async (key: string): Promise<boolean> => {
  const config = vscode.workspace.getConfiguration("vscode-jisho");
  const setting = config.inspect<boolean>(key);
  const next = !(config.get<boolean>(key) ?? false);
  const target =
    setting?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : setting?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
  await config.update(key, next, target);
  return next;
};

export const toggleHighlighting = async (): Promise<boolean> =>
  toggleBoolean("highlighting.enabled");

/**
 * Flip coverage of code comments, and say which way it went.
 *
 * Separate from `toggleHighlighting` because they answer different questions: that one is "colour
 * my prose", this one is "reach into my source files". Someone reading a Japanese codebase wants
 * this on and may not want their Markdown coloured at all.
 */
export const toggleCodeComments = async (): Promise<boolean> =>
  toggleBoolean("highlighting.codeComments");

/** Snapshot of the webview-relevant settings, read fresh so edits apply without a reload. */
export const currentSettings = (): HostSettings["settings"] => {
  const config = vscode.workspace.getConfiguration("vscode-jisho");
  return {
    textScale: config.get("appearance.textScale", 1.08),
    guideStyle: config.get("strokeOrder.guideStyle", "offset"),
    palette: config.get("appearance.palette", "standard"),
    tagLabels: config.get("appearance.tagLabels", "english"),
    colorExamples: config.get("appearance.colorExamples", true)
  };
};
