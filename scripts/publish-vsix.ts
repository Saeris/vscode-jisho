/**
 * Publish every platform .vsix built by package-platforms.ts to the VS Code Marketplace. Run by
 * Bumpy's publishCommand on release (needs VSCE_PAT in the env).
 *
 * Marketplace only, deliberately: v1 targets the editor the extension was built and tested in.
 * Open VSX is a separate distribution story — a second registry, its own token and namespace
 * claim, and editors (VSCodium, Cursor, Gitpod) none of which are part of the release test. It was
 * dropped rather than shipped untested; see docs/ROADMAP.md.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "dist-vsix");

const run = (cmd: string, args: string[]): void => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync("vp", ["exec", cmd, ...args], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
};

/** Wait, without pulling in a dependency for it. */
const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * Publish one package, retrying a TRANSPORT failure.
 *
 * The Marketplace API times out under load. Observed on the 0.2.0 release: five targets uploaded
 * and `win32-x64` came back "Request timeout: /_apis/gallery/publishers/…" — the most-used target,
 * left unpublished by an error that had nothing to do with the package.
 *
 * Retried blind rather than by inspecting the message, because `vsce` exits 1 for every failure and
 * gives nothing machine-readable to branch on. That is safe here: publishing the same version twice
 * is rejected by the Marketplace as a duplicate, so a retry after a request that actually SUCCEEDED
 * fails fast on the second attempt rather than doing anything destructive. The backoff is
 * deliberately generous — the failure mode is a busy server, and hammering it is what caused this.
 */
const publishWithRetry = (file: string, attempts = 3): void => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run("vsce", [
        "publish",
        "--no-yarn",
        "--packagePath",
        join(OUT_DIR, file)
      ]);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const wait = attempt * 30_000;
      console.log(
        `  ${file} failed (attempt ${attempt}/${attempts}); retrying in ${wait / 1000}s.`
      );
      sleep(wait);
    }
  }
};

const packages = readdirSync(OUT_DIR).filter((f) => f.endsWith(".vsix"));
if (packages.length === 0) {
  throw new Error(
    `No .vsix packages found in ${OUT_DIR} — run package-platforms first.`
  );
}

/**
 * Publish EVERY package, then report.
 *
 * The loop used to abort on the first failure, which is what turned one timed-out request into a
 * half-published release: the targets after it were never attempted at all. Collecting the failures
 * and throwing at the end means a bad network moment costs one target rather than all the ones
 * queued behind it, and the error names exactly which to republish.
 */
const failed: string[] = [];
for (const file of packages) {
  try {
    publishWithRetry(file);
  } catch {
    failed.push(file);
  }
}

if (failed.length > 0) {
  throw new Error(
    `Published ${packages.length - failed.length}/${packages.length} platform packages. ` +
      `FAILED: ${failed.join(", ")}. Re-run the release, or publish these by hand with ` +
      `\`vsce publish --no-yarn --packagePath dist-vsix/<file>\`.`
  );
}
console.log(`Published ${packages.length} platform packages.`);
