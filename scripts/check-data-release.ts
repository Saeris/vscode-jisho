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
import { readFileSync } from "node:fs";
import { SCHEMA_VERSION } from "../src/shared/schema.ts";

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

/**
 * The published artifact must match the schema THIS build expects.
 *
 * Presence is not enough, and the gap was not hypothetical: the data workflow broke on 2026-08-03
 * (it never provisioned the tokenizer dictionary the data build needs) and stayed broken through
 * the schema bump to v6. The release kept its July artifacts, so every asset this script checks for
 * was present — while the dictionary they contained was one schema behind. Publishing then would
 * have shipped an extension that downloads a database it refuses to open, for every new user.
 *
 * Read from the `.version` sidecar rather than the database, so this costs one small download
 * instead of 116 MB.
 */
const publishedSchema = (): number | undefined => {
  try {
    const body = execFileSync(
      "gh",
      ["release", "view", TAG, "--json", "assets", "--jq", ".assets[].name"],
      { encoding: "utf8" }
    );
    if (!body.includes("jisho-full.db.zst.version")) return undefined;
    execFileSync(
      "gh",
      [
        "release",
        "download",
        TAG,
        "-p",
        "jisho-full.db.zst.version",
        "-D",
        ".release-check",
        "--clobber"
      ],
      { encoding: "utf8" }
    );
    const text = readFileSync(
      ".release-check/jisho-full.db.zst.version",
      "utf8"
    );
    return Number(/schema(\d+)/u.exec(text)?.[1] ?? Number.NaN);
  } catch {
    return undefined;
  }
};

const published = publishedSchema();
if (published === undefined || Number.isNaN(published)) {
  // An artifact predating the schema stamp. Treated as a BLOCK rather than a warning: it cannot be
  // shown to match, and "probably fine" is exactly the reasoning that would ship the broken case.
  fail(
    `'${TAG}' does not record a schema version, so it cannot be shown to match this build ` +
      `(schema ${SCHEMA_VERSION}). Re-run the "Dictionary Data" workflow to republish it.`
  );
}
if (published !== SCHEMA_VERSION) {
  fail(
    `'${TAG}' publishes schema ${published}, but this build requires schema ${SCHEMA_VERSION}. ` +
      `Every new install would download a database the extension refuses to open. ` +
      `Re-run the "Dictionary Data" workflow before releasing.`
  );
}

console.log(
  `check-data-release: OK — '${TAG}' has the required word-DB artifacts at schema ` +
    `${SCHEMA_VERSION}${missingOptional.length === 0 ? ", and the names artifacts" : ""}.`
);
