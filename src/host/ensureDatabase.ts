/**
 * The DB delivery seam.
 *
 * The dictionary database is large, so it is NOT bundled into the .vsix — it is materialized
 * into the extension's global storage on first run. This function returns the on-disk path to a
 * ready-to-open `jisho.db`, provisioning it if absent.
 *
 * Two backends behind one signature:
 *   - **dev:** copy the locally-built `assets/jisho.db` (produced by `vp run build:data`) that
 *     sits alongside the extension source when running via F5.
 *   - **installed:** download the full dictionary from the rolling `dictionary-latest` GitHub
 *     Release with a progress notification, sha256-verified (see `download.ts`).
 */
import * as vscode from "vscode";
import { downloadDatabase } from "./download";

const DB_NAME = "jisho.db";
const VERSION_NAME = "jisho.db.version";

export const ensureDatabase = async (
  context: vscode.ExtensionContext
): Promise<string> => {
  const storageDir = context.globalStorageUri;
  await vscode.workspace.fs.createDirectory(storageDir);
  const target = vscode.Uri.joinPath(storageDir, DB_NAME);
  const targetVersion = vscode.Uri.joinPath(storageDir, VERSION_NAME);

  // dev backend: copy the DB shipped with the extension (assets/jisho.db). Re-copy whenever the
  // bundled version differs from the cached one, so a rebuilt DB propagates instead of a stale copy
  // being cached forever. (In production this only triggers on a genuine dictionary update.)
  const bundled = vscode.Uri.joinPath(context.extensionUri, "assets", DB_NAME);
  const bundledVersion = vscode.Uri.joinPath(
    context.extensionUri,
    "assets",
    VERSION_NAME
  );
  if (await exists(bundled)) {
    const wantVersion = await readText(bundledVersion);
    const haveVersion = await readText(targetVersion);
    if (!(await exists(target)) || wantVersion !== haveVersion) {
      await vscode.workspace.fs.copy(bundled, target, { overwrite: true });
      if (wantVersion !== undefined) {
        await vscode.workspace.fs.writeFile(
          targetVersion,
          Buffer.from(wantVersion, "utf8")
        );
      }
    }
    return target.fsPath;
  }

  // A previously-downloaded copy is fine even without a bundled source; refreshes happen via a
  // future "update dictionary" command, not per-activation network checks (offline-first).
  if (await exists(target)) return target.fsPath;

  // Installed backend: first run, no database yet — download it with a progress notification.
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Jisho: downloading dictionary…",
      cancellable: false
    },
    async (progress) => {
      let lastPercent = 0;
      await downloadDatabase(target.fsPath, (received, total) => {
        if (total <= 0) return;
        const percent = Math.floor((received / total) * 100);
        if (percent > lastPercent) {
          progress.report({
            increment: percent - lastPercent,
            message: `${percent}%`
          });
          lastPercent = percent;
        }
      });
    }
  );
  return target.fsPath;
};

const exists = async (uri: vscode.Uri): Promise<boolean> => {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
};

const readText = async (uri: vscode.Uri): Promise<string | undefined> => {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(
      "utf8"
    );
  } catch {
    return undefined;
  }
};
