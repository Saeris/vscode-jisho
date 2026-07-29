/**
 * Provision the compiled IPADIC tokenizer dictionary into `assets/lindera-ipadic/`.
 *
 * Run occasionally, not per-build:  vp run build:tokenizer-dict
 *
 * `lindera-nodejs` loads the dictionary from a directory at runtime (it is NOT embedded in the
 * native addon). We ship the compiled dictionary that Lindera publishes as a GitHub Release asset,
 * bundled into the .vsix (see .vscodeignore, docs/specs/14). This downloads the pinned release,
 * extracts the 8 dictionary files, and writes them where the extension and the tests expect them.
 *
 * The directory is gitignored (like the DB assets) — it's a provisioned build artifact, not source.
 * The version is PINNED to the `lindera-nodejs` package version: the serialized dictionary format is
 * version-locked to the lindera core that compiled it (loading a mismatched dict throws
 * `InvalidAutomatonError`), so this MUST match the `lindera-nodejs` dependency in package.json.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "assets", "lindera-ipadic");
// Our curated slang user-dictionary (committed source) is copied next to the compiled dict so it
// ships in the same bundled directory and loads by path at runtime. See src/data/slang-userdict.md.
const SLANG_SRC = join(root, "src", "data", "slang-userdict.csv");
const SLANG_DEST = join(OUT_DIR, "slang-userdict.csv");

// Pinned to the lindera-nodejs version in package.json (dictionary format is version-locked).
const LINDERA_VERSION = "4.0.1";
const DICT_URL = `https://github.com/lindera/lindera/releases/download/v${LINDERA_VERSION}/lindera-ipadic-${LINDERA_VERSION}.zip`;

// The 8 files load_dictionary_from_bytes / loadDictionary expect (the compiled dictionary dir).
const EXPECTED = [
  "metadata.json",
  "dict.da",
  "dict.vals",
  "dict.wordsidx",
  "dict.words",
  "matrix.mtx",
  "char_def.bin",
  "unk.bin"
];

const main = async (): Promise<void> => {
  console.log(`Downloading lindera-ipadic ${LINDERA_VERSION}…`);
  const res = await fetch(DICT_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to download ${DICT_URL}: ${res.status} ${res.statusText}`
    );
  }
  const zipped = new Uint8Array(await res.arrayBuffer());
  console.log(
    `  downloaded ${(zipped.length / 1e6).toFixed(1)} MB, extracting…`
  );

  const entries = unzipSync(zipped);

  // The archive nests the files under a `lindera-ipadic/` directory; match by basename so a layout
  // change upstream doesn't silently drop files.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const written = new Set<string>();
  for (const [path, bytes] of Object.entries(entries)) {
    const base = path.split("/").pop() ?? path;
    if (EXPECTED.includes(base)) {
      writeFileSync(join(OUT_DIR, base), bytes);
      written.add(base);
    }
  }

  const missing = EXPECTED.filter((f) => !written.has(f));
  if (missing.length > 0) {
    throw new Error(
      `Extracted dictionary is missing expected files: ${missing.join(", ")}. ` +
        `Archive layout may have changed for lindera ${LINDERA_VERSION}.`
    );
  }
  // A version marker, so a stale dict (after a lindera bump) is visible at a glance.
  writeFileSync(join(OUT_DIR, "VERSION"), `${LINDERA_VERSION}\n`);

  console.log(
    `Wrote ${written.size} files to assets/lindera-ipadic/ (lindera ${LINDERA_VERSION}).`
  );
};

/** Copy the committed slang user-dictionary next to the compiled dict (always — it's source that
    changes independently of the lindera version). */
const copySlang = (): void => {
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(SLANG_SRC, SLANG_DEST);
  console.log(`Copied slang user-dictionary to assets/lindera-ipadic/.`);
};

// Skip the DOWNLOAD when the dictionary is already present at the pinned version (idempotent, fast),
// but always refresh the slang copy (a cheap file copy of committed source).
const versionMarker = join(OUT_DIR, "VERSION");
if (existsSync(versionMarker)) {
  console.log(
    `assets/lindera-ipadic/ already provisioned; delete it to re-fetch.`
  );
} else {
  await main();
}
copySlang();
