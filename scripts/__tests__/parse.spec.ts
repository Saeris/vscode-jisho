/**
 * Scripts must avoid the TypeScript forms Node's type stripping cannot run.
 *
 * `vp check` typechecks these files, which is a DIFFERENT question from whether Node can execute
 * them. Node runs a `.ts` file by stripping annotations without evaluating them, so the few forms
 * that need real emit — parameter properties, enums, namespaces — fail at runtime with
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX while typechecking perfectly.
 *
 * Not hypothetical: `publish-vsix.ts` shipped a `constructor(readonly output: string)` in the
 * release whose whole purpose was to make releases more reliable, and it failed the publish step of
 * the very next one. The typecheck was green throughout, and the failure only surfaced in a job that
 * runs once per release.
 *
 * A pattern match rather than a real parse, deliberately and with its limits understood. The honest
 * alternatives were both worse: `node --check` does not understand TypeScript at all (it exits 1 on
 * a perfectly good `.ts` file, so it cannot distinguish anything), and importing the module EXECUTES
 * it, which for these scripts means publishing to the Marketplace or rebuilding a database. This
 * covers the forms that actually bite; it is a tripwire, not a compiler.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS_DIR = join(import.meta.dirname, "..");
const scripts = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts"));

/** The forms Node's strip-only mode rejects, with the error each produces. */
const UNSUPPORTED = [
  {
    name: "parameter property",
    // `constructor(readonly x: T)` / `private x` / `public x` in a parameter list.
    pattern:
      /constructor\s*\([^)]*\b(?:readonly|private|public|protected)\s+\w/su
  },
  { name: "enum", pattern: /^\s*(?:export\s+)?(?:const\s+)?enum\s+\w/mu },
  { name: "namespace", pattern: /^\s*(?:export\s+)?namespace\s+\w/mu }
];

/** Source with block and line comments removed, so prose about these forms is not mistaken for them. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

describe("scripts avoid syntax node cannot strip", () => {
  it("finds the scripts to check", () => {
    // WHY: a directory read that matched nothing would make every case below vacuous.
    expect(scripts.length).toBeGreaterThan(5);
  });

  it.each(scripts)("%s", (file) => {
    // Comments stripped first. Without this, a file DOCUMENTING one of these forms fails its own
    // check — which is exactly what `publish-vsix.ts` did, since the comment explaining the bug
    // quotes the syntax that caused it.
    const source = withoutComments(
      readFileSync(join(SCRIPTS_DIR, file), "utf8")
    );
    const found = UNSUPPORTED.filter((f) => f.pattern.test(source)).map(
      (f) => f.name
    );
    expect(found).toEqual([]);
  });
});
