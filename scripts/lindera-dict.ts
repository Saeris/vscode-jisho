/**
 * The compiled IPADIC dictionary's contract, in one place.
 *
 * Two scripts need it: `build-tokenizer-dict.ts` provisions the dictionary, and `package-platforms.ts`
 * refuses to package without it. They used to carry their own copies — the provisioner a full file
 * list, the packager a single sentinel file — and the copies drifted. Lindera 5.3 renamed `dict.da`
 * to `dict.trie`; the provisioner was updated and the packager was not, so `main` built and tested
 * green while every release would have failed at packaging, claiming the dictionary was missing when
 * it was present in the new layout.
 *
 * Importing one definition is what keeps them in step. `dictionaryProblems` is the shared check, so
 * the packager and the unit test ask exactly the same question the provisioner answers.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the compiled dictionary lives, relative to the repo root. Shipped inside every .vsix. */
export const dictionaryDir = (root: string): string =>
  join(root, "assets", "lindera-ipadic");

/**
 * The files `loadDictionary` expects in the compiled dictionary directory.
 *
 * Lindera 5.3 changed this layout along with the serialized FORMAT (v1 → v2): the double-array
 * `dict.da` became the FST-backed `dict.trie`, and `dict.valsidx` is new. The release archive is the
 * source of truth; the provisioner asserts against it, so a future reshuffle fails loudly there
 * rather than at runtime inside a shipped .vsix.
 */
export const DICTIONARY_FILES = [
  "metadata.json",
  "dict.trie",
  "dict.vals",
  "dict.valsidx",
  "dict.wordsidx",
  "dict.words",
  "matrix.mtx",
  "char_def.bin",
  "unk.bin"
] as const;

/**
 * The `lindera-nodejs` version from package.json, which the dictionary must match.
 *
 * The serialized format is version-locked to the Lindera core that compiled it, so a dictionary from
 * another release fails to load ("format version 1, but this build of Lindera reads format version
 * 2"). Read rather than restated, so a dependency bump cannot leave a stale copy behind.
 */
export const linderaVersion = (root: string): string => {
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8")
  );
  const range =
    typeof manifest === "object" &&
    manifest !== null &&
    "dependencies" in manifest &&
    typeof manifest.dependencies === "object" &&
    manifest.dependencies !== null &&
    "lindera-nodejs" in manifest.dependencies
      ? manifest.dependencies["lindera-nodejs"]
      : undefined;
  if (typeof range !== "string") {
    throw new Error("package.json has no `lindera-nodejs` dependency.");
  }
  return range.replace(/^[\^~]/u, "");
};

/**
 * Everything wrong with the provisioned dictionary, or an empty list when it is ready to ship.
 *
 * Checks the VERSION marker as well as the files. Presence alone is not enough: a dictionary left
 * over from before a Lindera bump has every file it used to need and still cannot be loaded by the
 * new addon, and that is the failure a release must not ship.
 */
export const dictionaryProblems = (root: string): string[] => {
  const dir = dictionaryDir(root);
  if (!existsSync(dir)) return [`${dir} does not exist`];
  const problems = DICTIONARY_FILES.filter(
    (file) => !existsSync(join(dir, file))
  ).map((file) => `missing ${file}`);
  const want = linderaVersion(root);
  const marker = join(dir, "VERSION");
  const have = existsSync(marker)
    ? readFileSync(marker, "utf8").trim()
    : undefined;
  if (have !== want) {
    problems.push(
      `built for lindera ${have ?? "(unknown)"}, but lindera-nodejs is ${want}`
    );
  }
  return problems;
};
