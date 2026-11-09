/**
 * Every module the packaged bundle requires must actually be there at runtime.
 *
 * 0.2.0 shipped an extension that could not activate: "Cannot find module 'vscode-textmate'",
 * thrown before its first line ran. The bundler had externalised a new dependency, and
 * `.vscodeignore` excludes `node_modules/**` apart from a few packages un-ignored BY NAME — so an
 * externalised dependency is not merely at risk of being absent, it is guaranteed to be.
 *
 * Nothing caught it, and the reason is worth stating: the E2E harness loads the extension from
 * SOURCE through `--extensionDevelopmentPath`, where `node_modules` sits next to the bundle. Every
 * test passed against a layout the published extension does not have. This checks the BUNDLE, which
 * is the artifact users get.
 *
 * Reads the `.cjs` files in `dist/` rather than unpacking a .vsix: packaging takes minutes and
 * produces the same bundles this reads in milliseconds. The .vsix adds only the file-inclusion
 * question, which `package-platforms.ts` already guards for the assets it ships.
 *
 * There is more than one bundle: the extension, the dictionary worker, and the chunk they share. A
 * require between them is relative (`./db.cjs`), and `dist/**` ships, so it resolves if the file is
 * there.
 */
import { describe, expect, it } from "vite-plus/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const DIST = join(root, "dist");
const BUNDLE = join(DIST, "extension.cjs");
const WORKER = join(DIST, "dictionaryWorker.cjs");

/**
 * Packages allowed to stay external, and why each is safe.
 *
 * Anything here MUST also be un-ignored in `.vscodeignore`, or it will be missing at runtime — the
 * exact failure this file exists to prevent. The assertion below checks that pairing rather than
 * trusting the list.
 */
const ALLOWED_EXTERNAL = [
  // Provided by the extension host itself; never on disk.
  "vscode",
  // Loads a platform-specific .node addon BY PACKAGE NAME, so it cannot be bundled.
  /^lindera-nodejs/
];

const isBuiltin = (id: string): boolean =>
  id.startsWith("node:") || builtinModules.includes(id);

const isAllowed = (id: string): boolean =>
  ALLOWED_EXTERNAL.some((rule) =>
    typeof rule === "string" ? rule === id : rule.test(id)
  );

/** One bundle to another, in `dist/`. */
const isRelative = (id: string): boolean => id.startsWith("./");

/** Every module `file` requires, once each. */
const requiresOf = (file: string): string[] => [
  ...new Set(
    [...readFileSync(file, "utf8").matchAll(/require\("([^"]+)"\)/gu)].map(
      (m) => m[1]
    )
  )
];

/** Every bundle in `dist/` (the webview's assets are in `dist/webview/`, and are not CommonJS). */
const bundles = (): string[] =>
  readdirSync(DIST)
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => join(DIST, name));

/** Everything `file` loads, following its requires into the other bundles. */
const graphOf = (file: string, seen = new Set<string>()): Set<string> => {
  for (const id of requiresOf(file)) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (isRelative(id)) graphOf(join(DIST, id), seen);
  }
  return seen;
};

/**
 * Skipped when there is no bundle to read.
 *
 * `vp pack` is not part of every job that runs `vp test` — the release gate runs the suite against
 * a provisioned database and never builds the host — so demanding the artifact would turn this from
 * a guard into a workflow-ordering trap. CI builds before testing (ci.yml), which is where the
 * question gets asked for real; locally it runs whenever you have packed.
 *
 * A skip is honest here in a way it would not be for a behavioural test: the artifact genuinely
 * does not exist, so there is nothing to be wrong about.
 */
const hasBundle = existsSync(BUNDLE);

describe.skipIf(!hasBundle)("the packaged host bundle", () => {
  it("requires nothing that will not exist at runtime", () => {
    // WHY: this is the 0.2.0 crash, as an assertion. A require that is neither a builtin, nor
    // `vscode`, nor a package deliberately shipped in node_modules, nor another bundle that is
    // there, is a module the extension host cannot resolve — and the symptom is total activation
    // failure, not a degraded feature.
    const unresolvable = bundles().flatMap((file) =>
      requiresOf(file)
        .filter(
          (id) =>
            !isBuiltin(id) &&
            !isAllowed(id) &&
            !(isRelative(id) && existsSync(join(DIST, id)))
        )
        .map((id) => `${file}: ${id}`)
    );
    expect(requiresOf(BUNDLE).length).toBeGreaterThan(0);
    expect(unresolvable).toEqual([]);
  });

  it("ships every package it leaves external", () => {
    // WHY: the two halves have to agree. `neverBundle` in vite.config.ts and the `!node_modules/…`
    // negations in .vscodeignore are edited in different files by different people, and a package
    // externalised without being un-ignored fails exactly like 0.2.0 did.
    const ignore = readFileSync(join(root, ".vscodeignore"), "utf8");
    const external = bundles()
      .flatMap(requiresOf)
      .filter((id) => !isBuiltin(id) && !isRelative(id) && id !== "vscode");

    const missing = external.filter(
      (id) => !ignore.includes(`!node_modules/${id.split("/")[0]}`)
    );
    expect(missing).toEqual([]);
  });

  it("runs the dictionaries in a worker that never loads vscode", () => {
    // WHY: VS Code provides `vscode` only on the extension host's main thread. A worker that
    // requires it — even through a shared chunk, by importing one helper from the wrong module —
    // dies on start, and then every search fails. Nothing else would notice until a user did.
    expect(existsSync(WORKER)).toBe(true);
    expect([...graphOf(WORKER)]).not.toContain("vscode");
  });
});
