/**
 * Collect the diagnostic snapshot, host-side.
 *
 * The pure shaping — Markdown, the issue body, the URL budget — lives in `shared/diagnostics.ts`.
 * This is the part that has to touch a runtime: `vscode`, `process.versions`, `node:os`, and the
 * dictionary's own metadata. Keeping the split means the sanitizer and the budget arithmetic stay
 * unit-testable without a VS Code instance. See docs/specs/20-crash-and-issue-reporting.md.
 */
import * as os from "node:os";
import * as vscode from "vscode";
import type { DiagnosticField, Diagnostics } from "../shared/diagnostics";
import { namesDatabaseExists } from "./ensureDatabase";

/** The settings whose values change behaviour, and the defaults they are compared against. */
const SETTING_DEFAULTS: Record<string, string | number | boolean> = {
  "hover.enabled": true,
  "highlighting.enabled": false,
  "grammar.enabled": true,
  "appearance.textScale": 1.08,
  "appearance.tagLabels": "english",
  "appearance.colorExamples": true,
  "appearance.palette": "standard",
  "strokeOrder.guideStyle": "offset",
  "dictionary.autoCheck": true
};

/**
 * Only the settings the user has CHANGED.
 *
 * The full block is nine rows saying nothing happened; the two someone changed are the
 * reproduction hint — "this only breaks with highlighting on" is a bug report that reproduces.
 *
 * Compared against a hardcoded table rather than `inspect().defaultValue`, deliberately: reading
 * the default from the same configuration object that supplies the value would make this a
 * tautology under a workspace override, and report nothing.
 */
const changedSettings = (): DiagnosticField[] => {
  const config = vscode.workspace.getConfiguration("vscode-jisho");
  const changed: DiagnosticField[] = [];
  for (const [key, fallback] of Object.entries(SETTING_DEFAULTS)) {
    const value = config.get<string | number | boolean>(key);
    if (value !== undefined && value !== fallback) {
      changed.push({ label: key, value: String(value) });
    }
  }
  return changed;
};

/** Read the dictionary's `.version` sidecar, which names the release the data came from. */
const dictionaryRevision = async (
  context: vscode.ExtensionContext
): Promise<string> => {
  try {
    const uri = vscode.Uri.joinPath(
      context.globalStorageUri,
      "jisho.db.version"
    );
    return (await vscode.workspace.fs.readFile(uri)).toString().trim();
  } catch {
    // A dev build runs against the repo's bundled DB and has no sidecar. Not an error worth
    // surfacing in a report — the absence itself says "not a downloaded dictionary".
    return "bundled (dev)";
  }
};

/**
 * Everything a maintainer needs to decide whether a report is reproducible.
 *
 * `meta` comes from the caller rather than being read here, because the dictionary may be the very
 * thing that failed to open — and a crash reporter that throws while collecting the crash is
 * useless. Absent metadata degrades to "unknown" rather than propagating.
 */
export const collectDiagnostics = async (
  context: vscode.ExtensionContext,
  meta: Record<string, string> | undefined
): Promise<Diagnostics> => {
  const version = String(context.extension.packageJSON.version ?? "unknown");
  const names = await namesDatabaseExists(context).catch(() => false);
  return {
    environment: [
      { label: "Extension", value: `${version} (${__JISHO_COMMIT__})` },
      { label: "VS Code", value: vscode.version },
      { label: "Node", value: process.versions.node },
      { label: "Chromium", value: process.versions.chrome ?? "unknown" },
      {
        label: "OS",
        value: `${process.platform} ${os.release()} (${process.arch})`
      }
    ],
    dictionary: [
      { label: "Variant", value: meta?.variant ?? "unknown" },
      { label: "Revision", value: await dictionaryRevision(context) },
      { label: "Built", value: meta?.builtAt ?? "unknown" },
      { label: "Schema", value: meta?.schemaVersion ?? "unknown" },
      { label: "JMdict", value: meta?.dictDate ?? "unknown" },
      { label: "KANJIDIC", value: meta?.kanjidicDate ?? "unknown" },
      { label: "Names DB", value: names ? "installed" : "not installed" }
    ],
    settings: changedSettings()
  };
};
