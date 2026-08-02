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

/** Snapshot of the webview-relevant settings, read fresh so edits apply without a reload. */
export const currentSettings = (): HostSettings["settings"] => {
  const config = vscode.workspace.getConfiguration("vscode-jisho");
  return {
    textScale: config.get("appearance.textScale", 1.08),
    guideStyle: config.get("strokeOrder.guideStyle", "offset"),
    palette: config.get("appearance.palette", "standard"),
    tagLabels: config.get("appearance.tagLabels", "english")
  };
};
