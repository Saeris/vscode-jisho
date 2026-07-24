/**
 * Dictionary update lifecycle + storage cleanup (spec 05 §4–5).
 *
 * The dictionary is downloaded, not bundled, and refreshes on the rolling `dictionary-latest`
 * release. This gives the installed extension a Wallaby-style update model — an automatic, throttled,
 * offline-safe check plus a manual command — that NOTIFIES rather than forces, and a sweep that keeps
 * `globalStorage` from accumulating superseded ~400 MB databases.
 *
 * Never runs against the dev (bundled) backend: F5 development refreshes from `assets/` directly
 * (see ensureDatabase), so an update prompt there would be noise.
 */
import * as vscode from "vscode";
import {
  DATA_RELEASE_BASE,
  downloadDatabase,
  fetchRemoteVersion,
  readVersionSidecar
} from "./download";

const DB_NAME = "jisho.db";
const NAMES_DB_NAME = "jisho-names.db";
const LAST_CHECK_KEY = "dictionary.lastUpdateCheck";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const AUTO_CHECK_SETTING = "vscode-jisho.dictionary.autoCheck";

/** Whether a bundled DB ships alongside the extension — i.e. we are in F5 dev, not an install. */
const hasBundledDb = async (
  context: vscode.ExtensionContext
): Promise<boolean> => {
  try {
    await vscode.workspace.fs.stat(
      vscode.Uri.joinPath(context.extensionUri, "assets", DB_NAME)
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Check whether a newer dictionary is available and, if so, offer to update. Automatic on activation
 * (throttled to once per 24h, silent on failure/up-to-date); `manual: true` ignores the throttle and
 * reports "up to date". Fire-and-forget on activation — never blocks or throws to the caller.
 */
export const checkForDictionaryUpdate = async (
  context: vscode.ExtensionContext,
  { manual }: { manual: boolean }
): Promise<void> => {
  // Dev backend refreshes from assets/ — nothing to check against the release.
  if (await hasBundledDb(context)) {
    if (manual) {
      void vscode.window.showInformationMessage(
        "Jisho: running from a locally-built dictionary — updates apply automatically when you rebuild it."
      );
    }
    return;
  }

  if (!manual) {
    // Respect the opt-out and the throttle for the automatic path only.
    const autoCheck = vscode.workspace
      .getConfiguration()
      .get<boolean>(AUTO_CHECK_SETTING, true);
    if (!autoCheck) return;
    const last = context.globalState.get<number>(LAST_CHECK_KEY, 0);
    if (Date.now() - last < CHECK_INTERVAL_MS) return;
    // Record the attempt up front so a flaky network doesn't re-prompt every activation.
    await context.globalState.update(LAST_CHECK_KEY, Date.now());
  }

  const target = vscode.Uri.joinPath(context.globalStorageUri, DB_NAME);
  const installed = await readVersionSidecar(target.fsPath);
  const remote = await fetchRemoteVersion(DATA_RELEASE_BASE, "jisho-full.db");

  if (remote === undefined) {
    // Offline or release unreachable. Only the manual path surfaces this; the auto path stays silent.
    if (manual) {
      void vscode.window.showWarningMessage(
        "Jisho: couldn't reach the dictionary release. Check your connection and try again."
      );
    }
    return;
  }

  if (installed === undefined || remote === installed) {
    if (manual) {
      void vscode.window.showInformationMessage(
        "Jisho: your dictionary is up to date."
      );
    }
    return;
  }

  // A newer version exists → notify, don't force.
  const choice = await vscode.window.showInformationMessage(
    `Jisho: a newer dictionary is available (${remote}). Update now?`,
    "Update",
    "Later",
    "Never"
  );
  if (choice === "Update") {
    await updateDictionary(context);
  } else if (choice === "Never") {
    await vscode.workspace
      .getConfiguration()
      .update(AUTO_CHECK_SETTING, false, vscode.ConfigurationTarget.Global);
  }
};

/**
 * Download the current dictionary over the installed one. `downloadDatabase` writes to a `.part` temp
 * file and only renames it into place after its checksum verifies, so a failed or interrupted update
 * leaves the working DB intact — the swap is atomic. Also refreshes the names DB in place when one is
 * already provisioned (a schema change affects both), but never PROVISIONS names here (that stays
 * lazy, on first names search).
 */
export const updateDictionary = async (
  context: vscode.ExtensionContext
): Promise<void> => {
  const storageDir = context.globalStorageUri;
  const target = vscode.Uri.joinPath(storageDir, DB_NAME);
  const namesTarget = vscode.Uri.joinPath(storageDir, NAMES_DB_NAME);
  const namesProvisioned = await uriExists(namesTarget);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Jisho: updating dictionary…",
      cancellable: false
    },
    async (progress) => {
      const onProgress = (received: number, total: number): void => {
        if (total <= 0) return;
        progress.report({
          message: `${Math.floor((received / total) * 100)}%`
        });
      };
      await downloadDatabase(target.fsPath, onProgress, DATA_RELEASE_BASE);
      if (namesProvisioned) {
        await downloadDatabase(
          namesTarget.fsPath,
          onProgress,
          DATA_RELEASE_BASE,
          "jisho-names.db"
        );
      }
    }
  );

  // A newer schema could have changed the DB shape; the open dictionaries must be reopened. Reloading
  // the window is the simplest correct reset (the DB is opened lazily on the next search).
  const reload = await vscode.window.showInformationMessage(
    "Jisho: dictionary updated. Reload the window to use it?",
    "Reload"
  );
  if (reload === "Reload") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
};

/**
 * Sweep `globalStorage` for dead files (spec 05 §5): superseded databases orphaned by an extension
 * upgrade, and leftover `.part` files from interrupted downloads. Keeps the ACTIVE `jisho.db` /
 * `jisho-names.db` and their `.version` sidecars; never removes a provisioned names DB just because
 * it is unused (it is an opt-in download). Best-effort and silent — failures never disrupt activation.
 */
export const sweepDictionaryStorage = async (
  context: vscode.ExtensionContext
): Promise<void> => {
  try {
    const storageDir = context.globalStorageUri;
    const keep = new Set([
      DB_NAME,
      `${DB_NAME}.version`,
      NAMES_DB_NAME,
      `${NAMES_DB_NAME}.version`
    ]);
    const entries = await vscode.workspace.fs.readDirectory(storageDir);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      // Only touch our own files: dictionary DBs, their sidecars, and interrupted downloads.
      const isOurs =
        name.startsWith("jisho") &&
        (name.endsWith(".db") ||
          name.endsWith(".db.version") ||
          name.endsWith(".part"));
      if (!isOurs) continue;
      if (keep.has(name)) continue;
      // Anything else matching (an orphaned versioned DB, a stale `.part`) is dead weight.
      try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(storageDir, name));
      } catch {
        // A file we can't delete now (locked/racing) is retried on the next activation.
      }
    }
  } catch {
    // No storage dir yet, or it can't be read — nothing to sweep.
  }
};

const uriExists = async (uri: vscode.Uri): Promise<boolean> => {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
};
