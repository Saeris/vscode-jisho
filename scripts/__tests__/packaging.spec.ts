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
 * Reads `dist/extension.cjs` rather than unpacking a .vsix: packaging takes minutes and produces the
 * same bundle this reads in milliseconds. The .vsix adds only the file-inclusion question, which
 * `package-platforms.ts` already guards for the assets it ships.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const BUNDLE = join(root, "dist", "extension.cjs");

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
    // `vscode`, nor a package deliberately shipped in node_modules, is a module the extension host
    // cannot resolve — and the symptom is total activation failure, not a degraded feature.
    const source = readFileSync(BUNDLE, "utf8");
    const required = [
      ...new Set(
        [...source.matchAll(/require\("([^"]+)"\)/gu)].map((m) => m[1])
      )
    ];
    expect(required.length).toBeGreaterThan(0);

    const unresolvable = required.filter(
      (id) => !isBuiltin(id) && !isAllowed(id)
    );
    expect(unresolvable).toEqual([]);
  });

  it("ships every package it leaves external", () => {
    // WHY: the two halves have to agree. `neverBundle` in vite.config.ts and the `!node_modules/…`
    // negations in .vscodeignore are edited in different files by different people, and a package
    // externalised without being un-ignored fails exactly like 0.2.0 did.
    const ignore = readFileSync(join(root, ".vscodeignore"), "utf8");
    const source = readFileSync(BUNDLE, "utf8");
    const external = [
      ...new Set(
        [...source.matchAll(/require\("([^"]+)"\)/gu)].map((m) => m[1])
      )
    ].filter((id) => !isBuiltin(id) && id !== "vscode");

    const missing = external.filter(
      (id) => !ignore.includes(`!node_modules/${id.split("/")[0]}`)
    );
    expect(missing).toEqual([]);
  });
});
