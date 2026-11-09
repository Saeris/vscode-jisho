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

/**
 * `--dry-run`: do everything but publish. Checks the packages exist and each names its target, that
 * both publishing CLIs resolve, and what the Marketplace already has — then prints each publish
 * command instead of running it.
 *
 * Run on Bumpy's version PR (ci.yml), so a broken release step fails while there is still a PR to fix,
 * rather than in the Publish job after the merge (audit I-10, I-11). Needs no tokens.
 */
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The three fields this script needs from package.json.
 *
 * Narrowed through a guard rather than asserted from `JSON.parse`'s `any`: a malformed manifest
 * would otherwise surface as `undefined` inside a publish command, where it reads as a registry
 * error rather than as the local problem it is.
 */
interface Manifest {
  name: string;
  version: string;
  publisher: string;
}

const isManifest = (value: unknown): value is Manifest =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).name === "string" &&
  typeof (value as Record<string, unknown>).version === "string" &&
  typeof (value as Record<string, unknown>).publisher === "string";

const parsed: unknown = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
);
if (!isManifest(parsed)) {
  throw new Error(
    "package.json is missing one of `name`, `version` or `publisher`."
  );
}
const manifest = parsed;
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
    // `unknown`, then read through optional chaining: every hop below is already guarded, so an
    // unexpected shape yields an empty set rather than throwing inside a release.
    const body: unknown = await response.json();
    const gallery = body as GalleryResponse;
    const versions = gallery.results?.[0]?.extensions?.[0]?.versions ?? [];
    return new Set(
      versions
        .filter(
          (v): v is GalleryVersion & { targetPlatform: string } =>
            v.version === version && typeof v.targetPlatform === "string"
        )
        .map((v) => v.targetPlatform)
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
  if (DRY_RUN) return "";
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

/**
 * Carries vsce's output, so the caller can tell WHY a publish failed.
 *
 * The field is assigned in the body rather than declared as a parameter property
 * (`constructor(readonly output: string)`). Node runs this file with type STRIPPING, which erases
 * annotations without evaluating them, and a parameter property is the one TypeScript form that
 * needs real emit — it fails at runtime with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX while typechecking
 * perfectly. That shipped once, in the release that was meant to fix releases.
 */
class PublishError extends Error {
  readonly output: string;

  constructor(output: string) {
    super(lastLine(output));
    this.output = output;
  }
}

/** A version the Marketplace already has. Not a failure to recover from — the work is done. */
/**
 * A rejection that means "this version is already there", from either registry.
 *
 * The two word it differently — vsce says the version "already exists", ovsx answers with a 409 and
 * names the extension version — so both phrasings are matched here rather than in each publisher.
 */
const isDuplicate = (error: unknown): boolean =>
  error instanceof PublishError &&
  /already exists|is already published|409/iu.test(error.output);

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
/**
 * The two registries, as the command each needs to publish one already-built `.vsix`.
 *
 * `ovsx` needs the target named explicitly: `vsce` reads it back out of the package, but ovsx would
 * otherwise register every platform build under the same universal entry and each would overwrite
 * the last.
 *
 * Open VSX authenticates in one of two ways and chooses by itself. With `OVSX_PAT` set it uses the
 * token; with no token and an OIDC ID token available (GitHub Actions, `id-token: write`) it
 * exchanges that for a short-lived one instead. Nothing here has to pick — which is what lets the
 * token be retired later by deleting the secret rather than by changing this file.
 */
const REGISTRIES = [
  {
    name: "Marketplace",
    command: "vsce",
    args: (file: string): string[] => [
      "publish",
      "--no-yarn",
      "--packagePath",
      join(OUT_DIR, file)
    ]
  },
  {
    name: "Open VSX",
    command: "ovsx",
    args: (file: string): string[] => {
      const target = targetOf(file, manifest.version);
      return [
        "publish",
        join(OUT_DIR, file),
        ...(target === undefined ? [] : ["--target", target])
      ];
    }
  }
] as const;

type Registry = (typeof REGISTRIES)[number];

const publishWithRetry = (
  registry: Registry,
  file: string,
  attempts = 3
): void => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run(registry.command, registry.args(file));
      return;
    } catch (error) {
      // Already published, which a re-run after a partial failure hits for every target that DID
      // land. Retrying it is pure delay: the answer will not change, and 0.2.0's recovery run spent
      // 90s per already-published target before reaching the one that needed publishing.
      if (isDuplicate(error)) {
        console.log(
          `  ${file} is already on the ${registry.name}; nothing to do.`
        );
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

if (DRY_RUN) {
  // The publish commands are only printed below, so check here that they would run: a CLI missing
  // from the install fails a real release only after the merge.
  for (const { command } of [
    { command: "vsce" },
    { command: "ovsx" }
  ] as const) {
    const version = execFileSync("vp", ["exec", command, "--version"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32"
    }).trim();
    console.log(`${command} ${version}`);
  }
  // Every package must be a platform build of THIS version. One whose name does not parse would be
  // published as universal to Open VSX, where each platform build overwrites the last; one left
  // over from an earlier version would be offered to the registries again.
  const strays = packages.filter(
    (file) => targetOf(file, manifest.version) === undefined
  );
  if (strays.length > 0) {
    throw new Error(
      `These packages are not platform builds of ${manifest.version}: ${strays.join(", ")}`
    );
  }
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

/**
 * Publish every package to ONE registry, and report what failed.
 *
 * Each registry is finished before the next is started, rather than publishing each package to both
 * in turn. That ordering is the point: the Marketplace is the primary channel, and interleaving is
 * exactly what made a missing Open VSX token leave a half-published Marketplace release behind —
 * the reason Open VSX was dropped before v1 rather than shipped. Now an Open VSX problem can only
 * ever happen with the Marketplace release already complete.
 */
const publishAll = (
  registry: Registry,
  skip: ReadonlySet<string>
): string[] => {
  const failed: string[] = [];
  let skipped = 0;
  console.log(`${String.fromCharCode(10)}Publishing to the ${registry.name}…`);
  for (const file of packages) {
    const target = targetOf(file, manifest.version);
    if (target !== undefined && skip.has(target)) {
      console.log(`- skipping ${file} (already published)`);
      skipped++;
      continue;
    }
    try {
      publishWithRetry(registry, file);
    } catch {
      failed.push(file);
    }
  }
  console.log(
    `${registry.name}: ${DRY_RUN ? "would publish" : "published"} ${packages.length - failed.length - skipped}/${packages.length}` +
      (skipped > 0 ? ` (${skipped} already there)` : "") +
      (failed.length > 0 ? `, ${failed.length} FAILED` : "") +
      "."
  );
  return failed;
};

const marketplaceFailures = publishAll(REGISTRIES[0], published);
// Attempted even when the Marketplace had failures: the two registries are independent, and
// withholding a good Open VSX release because the Marketplace had a bad minute helps nobody. Both
// sets of failures are reported together below.
//
// No pre-query of what Open VSX already has, unlike the Marketplace: a duplicate is recognised from
// the 409 it answers with (see `isDuplicate`), which costs one request per already-published target
// on a re-run and saves maintaining a second gallery client.
const openVsxFailures = publishAll(REGISTRIES[1], new Set());

const problems = [
  ...marketplaceFailures.map((f) => `Marketplace: ${f}`),
  ...openVsxFailures.map((f) => `Open VSX: ${f}`)
];
if (problems.length > 0) {
  const indent = `${String.fromCharCode(10)}  `;
  throw new Error(
    `Publishing did not complete. FAILED:${indent}${problems.join(indent)}${String.fromCharCode(10)}` +
      `Re-run the release — packages already published are skipped — or publish by hand with ` +
      `\`vsce publish --no-yarn --packagePath dist-vsix/<file>\` and ` +
      `\`ovsx publish dist-vsix/<file> --target <target>\`.`
  );
}
