/**
 * The DB delivery seam.
 *
 * The dictionary database is large, so it is NOT bundled into the .vsix — it is materialized
 * into the extension's global storage on first run. This function returns the on-disk path to a
 * ready-to-open `jisho.db`, provisioning it if absent.
 *
 * Two backends behind one signature:
 *   - **dev (M1):** copy the locally-built `assets/jisho.db` (produced by `vp run build:data`)
 *     that ships alongside the extension during development.
 *   - **release (later):** download the prebuilt DB from a GitHub Release asset with progress.
 *
 * M1 implements the dev copy and leaves the download path as an explicit, clearly-marked TODO so
 * the call site never changes when we add it.
 */
import * as vscode from "vscode";

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

  // A previously-provisioned copy (e.g. downloaded) is fine even without a bundled source.
  if (await exists(target)) return target.fsPath;

  // release backend (TODO): download the prebuilt DB from the GitHub Release asset into
  // `target` with a vscode.window.withProgress UI, then return target.fsPath.
  throw new Error(
    `Dictionary database not found. Run \`vp run build:data\` to generate assets/${DB_NAME}, ` +
      `or (future) let the extension download it on first run.`
  );
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
