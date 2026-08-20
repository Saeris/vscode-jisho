/**
 * The DB delivery seam.
 *
 * The dictionary database is large, so it is NOT bundled into the .vsix — it is materialized
 * into the extension's global storage on first run. This function returns the on-disk path to a
 * ready-to-open `jisho.db`, provisioning it if absent.
 *
 * Two backends behind one signature:
 *   - **dev:** link (or copy) the locally-built `assets/jisho.db` (produced by `vp run build:data`)
 *     that sits alongside the extension source when running via F5.
 *   - **installed:** download the full dictionary from the rolling `dictionary-latest` GitHub
 *     Release with a progress notification, sha256-verified (see `download.ts`).
 */
import { link, unlink } from "node:fs/promises";
import { log } from "./log";
import * as vscode from "vscode";
import { downloadDatabase } from "./download";

const DB_NAME = "jisho.db";
const VERSION_NAME = "jisho.db.version";

/**
 * Materialize `from` at `to` as a HARD LINK, falling back to a byte copy.
 *
 * The dev database is ~450MB and `workspace.fs.copy` measured **7,322ms** of every fresh-profile
 * activation — the single largest cost before the first search, against 2ms to actually open it.
 * A hard link is the same bytes under a second name: measured at **6ms**, and it consumes no extra
 * disk. The DB is opened read-only, so sharing the inode is safe.
 *
 * Falls back to a real copy whenever linking fails, which is not exotic: hard links cannot cross
 * volumes, so a globalStorage on a different drive from the repo (or a filesystem without link
 * support) lands here. Correctness never depends on which path ran.
 *
 * STALENESS is handled by the caller, and must be: a rebuild renames a NEW file over
 * `assets/jisho.db` (see `promote` in scripts/build-data.ts), which leaves this link pointing at
 * the old inode. The `.version` sidecar comparison is what catches that and re-links — without it
 * the extension would silently serve the previous dictionary forever.
 */
const linkOrCopy = async (from: vscode.Uri, to: vscode.Uri): Promise<void> => {
  // Remove any existing entry first: `link()` fails on an existing destination, and a stale link
  // (or a copy from before this change) is exactly what we are replacing.
  //
  // Whether this SUCCEEDED matters, and used to be discarded. If the unlink worked and the link
  // then failed, the destination is gone — so a caller told "keep using the existing copy" would
  // be pointed at a file that no longer exists. `copy` with `overwrite` can restore it, which is
  // why the fallback runs even when linking failed for a reason copying will share.
  let removed = false;
  try {
    await unlink(to.fsPath);
    removed = true;
  } catch {
    // Not present, or held open by another process — `link` below reports the real problem.
  }
  try {
    await link(from.fsPath, to.fsPath);
  } catch (linkError) {
    try {
      await vscode.workspace.fs.copy(from, to, { overwrite: true });
    } catch (copyError) {
      // Both failed. Say which state we left behind, because it decides whether the caller can
      // fall back: with the old file deleted there is nothing to serve.
      throw removed
        ? new Error(
            `could not replace the dictionary and the previous copy was removed: ${String(copyError)}`,
            { cause: copyError }
          )
        : (copyError ?? linkError);
    }
  }
};

export const ensureDatabase = async (
  context: vscode.ExtensionContext
): Promise<string> => {
  const storageDir = context.globalStorageUri;
  await vscode.workspace.fs.createDirectory(storageDir);
  const target = vscode.Uri.joinPath(storageDir, DB_NAME);
  const targetVersion = vscode.Uri.joinPath(storageDir, VERSION_NAME);

  // dev backend: link the DB shipped with the extension (assets/jisho.db). Re-link whenever the
  // bundled version differs from the cached one, so a rebuilt DB propagates instead of a stale copy
  // being cached forever. (In production this only triggers on a genuine dictionary update.)
  //
  // The version check is load-bearing for LINKS specifically, not just freshness: a rebuild renames
  // a new file into place, so the old link would otherwise keep resolving to the previous inode.
  const bundled = vscode.Uri.joinPath(context.extensionUri, "assets", DB_NAME);
  const bundledVersion = vscode.Uri.joinPath(
    context.extensionUri,
    "assets",
    VERSION_NAME
  );
  if (await exists(bundled)) {
    const wantVersion = await readText(bundledVersion);
    const haveVersion = await readText(targetVersion);
    const havePrevious = await exists(target);
    if (!havePrevious || wantVersion !== haveVersion) {
      try {
        await linkOrCopy(bundled, target);
        if (wantVersion !== undefined) {
          await vscode.workspace.fs.writeFile(
            targetVersion,
            Buffer.from(wantVersion, "utf8")
          );
        }
      } catch (err) {
        // Re-linking failed. If there is NO database this is fatal and the error must reach the
        // caller — but when one is already there, refusing to serve it is strictly worse than
        // serving a stale one.
        //
        // Windows makes this ordinary rather than exotic: an open file cannot be unlinked or
        // overwritten, so a second window, a debug host, or this extension's own previous
        // activation holding the DB turns a routine re-link into
        // `EBUSY: resource busy or locked, unlink '…jisho.db'`. That threw out of `ensureDatabase`,
        // rejected `#dict()`, and every dictionary lookup went quiet — while grammar notes, which
        // read in-memory tables and never touch the database, kept working. A user sees hovers that
        // half-work and no reason why.
        if (!havePrevious) throw err;
        log().warn(
          `could not refresh the dictionary (${String(err)}); using the existing copy. ` +
            `On Windows this usually means another VS Code window has it open.`
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

const NAMES_DB_NAME = "jisho-names.db";

/**
 * Whether the names dictionary is already on disk — WITHOUT provisioning it.
 *
 * `ensureNamesDatabase` downloads a ~400MB artifact when it is absent, so anything that merely
 * wants to know "can we answer name queries?" must not call it. The `#name`/`#place` search tags
 * are the case: they are hidden when names are unavailable, and a suggestion list that triggered a
 * large download just by being computed would be indefensible.
 *
 * Deliberately the same two branches `ensureNamesDatabase` checks before it downloads, so the two
 * cannot disagree about what "present" means.
 */
export const namesDatabaseExists = async (
  context: vscode.ExtensionContext
): Promise<boolean> => {
  const bundled = vscode.Uri.joinPath(
    context.extensionUri,
    "assets",
    NAMES_DB_NAME
  );
  if (await exists(bundled)) return true;
  const target = vscode.Uri.joinPath(context.globalStorageUri, NAMES_DB_NAME);
  return exists(target);
};

/**
 * Provision the optional JMnedict names database (`jisho-names.db`), returning its on-disk path.
 * Unlike the word DB this has **no bundled dev copy** — it is download-only (JMnedict would roughly
 * double the bundled data). If a locally-built `assets/jisho-names.db` exists (from
 * `vp run build:data:names`), F5 development uses it directly; otherwise it downloads the
 * `jisho-names.db.zst` artifact from the same rolling release. Provisioned lazily on the first names
 * query so users who never search names never download it.
 */
export const ensureNamesDatabase = async (
  context: vscode.ExtensionContext
): Promise<string> => {
  const storageDir = context.globalStorageUri;
  await vscode.workspace.fs.createDirectory(storageDir);
  const target = vscode.Uri.joinPath(storageDir, NAMES_DB_NAME);

  // dev backend: use the locally-built names DB shipped alongside the source under F5.
  const bundled = vscode.Uri.joinPath(
    context.extensionUri,
    "assets",
    NAMES_DB_NAME
  );
  if (await exists(bundled)) return bundled.fsPath;

  // A previously-downloaded copy is fine (offline-first).
  if (await exists(target)) return target.fsPath;

  // Installed backend: download the names artifact with a progress notification.
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Jisho: downloading names dictionary…",
      cancellable: false
    },
    async (progress) => {
      let lastPercent = 0;
      await downloadDatabase(
        target.fsPath,
        (received, total) => {
          if (total <= 0) return;
          const percent = Math.floor((received / total) * 100);
          if (percent > lastPercent) {
            progress.report({
              increment: percent - lastPercent,
              message: `${percent}%`
            });
            lastPercent = percent;
          }
        },
        undefined,
        "jisho-names.db"
      );
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
