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
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NEWLINE = new RegExp(
  String.fromCharCode(13) + "?" + String.fromCharCode(10),
  "u"
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "dist-vsix");

const manifest = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
) as { name: string; version: string; publisher: string };
const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;

/** Only the slice of the gallery response this needs: which targets exist for which version. */
interface GalleryVersion {
  version?: string;
  targetPlatform?: string;
}
interface GalleryExtension {
  versions?: GalleryVersion[];
}
interface GalleryResult {
  extensions?: GalleryExtension[];
}
interface GalleryResponse {
  results?: GalleryResult[];
}

/**
 * The platform targets the Marketplace ALREADY has for this version.
 *
 * A release that fails partway leaves some targets published and some not, and re-running it then
 * re-uploads the ones that succeeded — each of which is rejected as a duplicate, so a recovery run
 * spends its time re-asking a settled question instead of finishing the release.
 *
 * 0.2.0 is the case this was written for, and it is worth recording what actually happened there:
 * `win32-x64` failed with "Request timeout", and the package HAD been accepted — the API simply did
 * not answer in time. So the release was complete while CI called it failed. A recovery run in that
 * state has nothing to publish at all, which is precisely why it must be able to work that out from
 * the Marketplace rather than from the exit code of the run that uploaded it.
 *
 * `flags: 2151` is what makes this usable. The default query returns only VALIDATED versions, and
 * the Marketplace validates asynchronously — so a target uploaded a minute ago looks absent, and
 * skipping on that answer would be worse than not checking at all. This flag set includes versions
 * still in validation, which is the question we actually care about: has it been UPLOADED.
 *
 * Never throws. If the query fails, every package is attempted, which is the behaviour before this
 * existed — a duplicate rejection is noisy but harmless, while wrongly skipping is a missing target.
 */
const alreadyPublished = async (version: string): Promise<Set<string>> => {
  try {
    const response = await fetch(
      "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
      {
        method: "POST",
        headers: {
          Accept: "application/json;api-version=7.2-preview.1",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }] }],
          flags: 2151
        })
      }
    );
    if (!response.ok) return new Set();
    const body = (await response.json()) as GalleryResponse;
    const versions = body.results?.[0]?.extensions?.[0]?.versions ?? [];
    return new Set(
      versions
        .filter((v) => v.version === version && v.targetPlatform)
        .map((v) => v.targetPlatform as string)
    );
  } catch (error) {
    console.log(`  could not query the Marketplace (${String(error)});`);
    console.log("  attempting every package.");
    return new Set();
  }
};

/**
 * The target a package filename names, e.g. `win32-x64` from
 * `vscode-jisho-win32-x64-0.2.0.vsix`. Undefined for a universal package, which has no target
 * segment and is therefore never skipped.
 */
const targetOf = (file: string, version: string): string | undefined => {
  const match = new RegExp(
    `^${manifest.name}-(.+)-${version.replace(/\./gu, ".")}.vsix$`,
    "u"
  ).exec(file);
  return match?.[1];
};

const run = (cmd: string, args: string[]): string => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  // `pipe`, not `inherit`: the output has to be READ to tell an "already exists" rejection from a
  // transport failure, and vsce writes that to stderr. Echoed so the log still shows everything.
  try {
    const out = execFileSync("vp", ["exec", cmd, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    process.stdout.write(out);
    return out;
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    process.stdout.write(text);
    throw new PublishError(text);
  }
};

/** The last non-empty line of vsce output, which is where it puts the reason. */
const lastLine = (text: string): string => {
  const parts = text.trim().split(NEWLINE).filter(Boolean);
  return parts.at(-1) ?? "publish failed";
};

/** Carries vsce's output, so the caller can tell WHY a publish failed. */
class PublishError extends Error {
  constructor(readonly output: string) {
    super(lastLine(output));
  }
}

/** A version the Marketplace already has. Not a failure to recover from — the work is done. */
const isDuplicate = (error: unknown): boolean =>
  error instanceof PublishError && /already exists/iu.test(error.output);

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
 * Only a TRANSPORT failure is retried. "already exists" means the target is published and the retry
 * would just re-ask the same question — which is not merely wasted time: 0.2.0's recovery run spent
 * 90s on each already-published target before reaching the one that actually needed publishing.
 *
 * The backoff is deliberately generous, since the failure mode is a busy server and hammering it is
 * what caused this.
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
      // Already published, which a re-run after a partial failure hits for every target that DID
      // land. Retrying it is pure delay: the answer will not change, and 0.2.0's recovery run spent
      // 90s per already-published target before reaching the one that needed publishing.
      if (isDuplicate(error)) {
        console.log(`  ${file} is already on the Marketplace; nothing to do.`);
        return;
      }
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
const published = await alreadyPublished(manifest.version);
if (published.size > 0) {
  console.log(
    `Marketplace already has ${manifest.version} for: ${[...published].sort().join(", ")}`
  );
}

const failed: string[] = [];
let skipped = 0;
for (const file of packages) {
  const target = targetOf(file, manifest.version);
  if (target !== undefined && published.has(target)) {
    console.log(`- skipping ${file} (already published)`);
    skipped++;
    continue;
  }
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
console.log(
  `Published ${packages.length - skipped} platform packages` +
    (skipped > 0 ? ` (${skipped} already on the Marketplace).` : ".")
);
