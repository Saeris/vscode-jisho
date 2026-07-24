/**
 * Release precondition (spec 05 §3): the extension must not publish before the dictionary artifacts
 * it downloads on first run exist on the rolling `dictionary-latest` GitHub Release. Otherwise a user
 * installs the .vsix and then cannot obtain a dictionary — a broken first run for everyone.
 *
 * Run before `bumpy ci release` (wired as the first step of release.yml). Uses `gh` (already
 * authenticated in CI via GH_TOKEN). Exits non-zero if the REQUIRED word-DB trio is missing; the
 * names DB is an optional on-demand download, so its absence is a warning, not a block (matching the
 * data workflow, which builds names as a separate, non-blocking step).
 *
 *   vp exec node scripts/check-data-release.ts
 */
import { execFileSync } from "node:child_process";

const TAG = "dictionary-latest";

// The word DB is downloaded on first activation — without it nothing works. Hard requirement.
const REQUIRED = [
  "jisho-full.db.zst",
  "jisho-full.db.zst.sha256",
  "jisho-full.db.zst.version"
];
// The names DB is fetched lazily on the first names search and degrades gracefully when absent.
const OPTIONAL = [
  "jisho-names.db.zst",
  "jisho-names.db.zst.sha256",
  "jisho-names.db.zst.version"
];

const fail = (message: string): never => {
  console.error(`check-data-release: ${message}`);
  process.exit(1);
};

const listAssets = (): string[] => {
  try {
    const json = execFileSync(
      "gh",
      ["release", "view", TAG, "--json", "assets", "--jq", ".assets[].name"],
      { encoding: "utf8" }
    );
    return json.split("\n").filter((n) => n !== "");
  } catch {
    return fail(
      `the '${TAG}' release does not exist (or gh could not read it). Run the "Dictionary Data" workflow to publish it before releasing the extension.`
    );
  }
};

const present = new Set(listAssets());
const missingRequired = REQUIRED.filter((a) => !present.has(a));
if (missingRequired.length > 0) {
  fail(
    `'${TAG}' is missing required word-DB assets: ${missingRequired.join(", ")}. ` +
      `Run the "Dictionary Data" workflow (it publishes the full trio) before releasing.`
  );
}

const missingOptional = OPTIONAL.filter((a) => !present.has(a));
if (missingOptional.length > 0) {
  console.warn(
    `check-data-release: WARNING — '${TAG}' is missing the optional names-DB assets: ` +
      `${missingOptional.join(", ")}. The names feature will be unavailable until they are published; ` +
      `the release can still proceed.`
  );
}

console.log(
  `check-data-release: OK — '${TAG}' has the required word-DB artifacts${
    missingOptional.length === 0 ? " and the names artifacts" : ""
  }.`
);
