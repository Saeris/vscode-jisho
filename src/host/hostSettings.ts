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
 * Whether grammar notes are shown. Read per hover rather than cached, so toggling the setting
 * applies to the next hover instead of requiring a reload — same discipline as `hover.enabled`.
 */
export const grammarEnabled = (): boolean =>
  vscode.workspace
    .getConfiguration("vscode-jisho")
    .get<boolean>("grammar.enabled", true);

/**
 * Flip part-of-speech highlighting, and say which way it went.
 *
 * Writes back to the scope the value CAME from. `inspect` is what makes that possible: a user who
 * turned highlighting on for one Japanese-notes workspace expects the toggle to flip that
 * workspace, not to write a global they never set — and a global write would leave the workspace
 * value still in force, so the command would appear to do nothing at all.
 *
 * Falls back to Global when nothing is set anywhere, which is the first press on a fresh install.
 */
export const toggleHighlighting = async (): Promise<boolean> => {
  const config = vscode.workspace.getConfiguration("vscode-jisho");
  const setting = config.inspect<boolean>("highlighting.enabled");
  const next = !(config.get<boolean>("highlighting.enabled") ?? false);
  const target =
    setting?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : setting?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
  await config.update("highlighting.enabled", next, target);
  return next;
};

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
