/**
 * Dictionary update lifecycle + storage cleanup (spec 05 §4–5).
 *
 * The dictionary is downloaded, not bundled, and refreshes in place on its schema's release
 * (`dictionary-v7`). This gives the installed extension a Wallaby-style update model — an automatic, throttled,
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
import { SCHEMA_VERSION, schemaOfVersion } from "../shared/schema";
import type { DictionaryStatus } from "../shared/messages";
import type { Closable, DictionaryLifecycle } from "./lifecycle";

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
  {
    manual,
    dictionaries
  }: {
    manual: boolean;
    dictionaries?: { words?: Updatable; names?: Updatable };
  }
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

  // Never offer a database this build cannot open.
  //
  // The update replaces the WORKING database, so offering an incompatible one is not a failed update,
  // it is a broken install: every lookup then fails on the schema check, and the update check would
  // report the "new" version as installed. The sidecar names its schema (`full schema6 …`); one that
  // does not, or names another, is treated as incompatible rather than given the benefit of the doubt.
  const remoteSchema = schemaOfVersion(remote);
  if (remoteSchema !== SCHEMA_VERSION) {
    if (manual) {
      void vscode.window.showInformationMessage(
        remoteSchema !== undefined && remoteSchema > SCHEMA_VERSION
          ? "Jisho: a newer dictionary is available, but it needs a newer version of Jisho. Update the extension to get it."
          : "Jisho: no dictionary update is available for this version of Jisho."
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
    await updateDictionary(context, dictionaries);
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
  context: vscode.ExtensionContext,
  /**
   * The dictionaries' lifecycles, so an OPEN database is swapped in place.
   *
   * This used to be a `closeDatabases` callback, run BEFORE the download — which is why the update
   * failed on Windows (audit SM-4): the download takes minutes, any hover during it reopened the
   * database, and the final rename then hit an open file. A lifecycle keeps the old file serving
   * through the download and closes it only at the swap, immediately before the rename.
   *
   * Optional so the update path stays callable without a provider (its own tests do exactly that).
   * A database that is not open is replaced with a plain rename, which is safe.
   */
  dictionaries?: { words?: Updatable; names?: Updatable }
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
      const report = (received: number, total: number): void => {
        if (total <= 0) return;
        progress.report({
          message: `${Math.floor((received / total) * 100)}%`
        });
      };
      await replace(
        dictionaries?.words,
        target.fsPath,
        "jisho-full.db",
        report
      );
      if (namesProvisioned) {
        await replace(
          dictionaries?.names,
          namesTarget.fsPath,
          "jisho-names.db",
          report
        );
      }
    }
  );

  // No reload. The swap reopened the new file in place, and the schema check above guarantees this
  // build can read it — the reload used to be the "simplest correct reset" for a shape change that
  // can no longer arrive this way.
  void vscode.window.showInformationMessage("Jisho: dictionary updated.");
};

/** What the update needs from a dictionary's lifecycle. */
export interface Updatable {
  readonly status: DictionaryStatus;
  update: DictionaryLifecycle<Closable>["update"];
  /** Open it — used to reopen one that failed, once the download has fixed it. */
  acquire: () => Promise<unknown>;
}

/**
 * Download one database over the installed copy: through its lifecycle when it is open, so the old
 * file serves until the swap; with a plain rename when nothing has it open.
 *
 * A database that FAILED to open is reopened after the download. That is the upgrade path: a new
 * version of Jisho needs a new schema, the old file fails with `schema-older`, and the panel offers
 * this update. Without the reopen the panel kept showing that failure until the next search.
 */
const replace = async (
  lifecycle: Updatable | undefined,
  dest: string,
  prefix: string,
  report: (received: number, total: number) => void
): Promise<void> => {
  if (lifecycle?.status.state === "ready") {
    await lifecycle.update(async (swap, onPercent) => {
      await downloadDatabase(
        dest,
        (received, total) => {
          report(received, total);
          if (total > 0) onPercent(Math.floor((received / total) * 100));
        },
        DATA_RELEASE_BASE,
        prefix,
        swap
      );
    });
    return;
  }
  await downloadDatabase(dest, report, DATA_RELEASE_BASE, prefix);
  if (lifecycle?.status.state === "failed") await lifecycle.acquire();
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
