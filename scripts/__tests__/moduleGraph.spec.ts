import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every module the build scripts reach at runtime must be resolvable by PLAIN NODE.
 *
 * `src/` is consumed by two loaders with different resolution rules. Vite/Rolldown/Vitest resolve
 * `./japanese` happily; `vp exec node scripts/build-data.ts` does not, because Node's TypeScript
 * support strips types without adding a resolver. So the same import is fine in the extension bundle
 * and fatal in a build script.
 *
 * This has broken the release twice. `refactor(shared)` gave `ruby.ts` an extensionless
 * `./japanese`, and a later perf change gave `exampleLinks.ts` an extensionless `./ruby` — each
 * turning `vp run build:data` into an immediate ERR_MODULE_NOT_FOUND. Neither was caught, because
 * per-push CI does not build the dictionary: only the Release workflow does, on `main`, after the
 * merge. The failure was therefore invisible until it was already on the default branch.
 *
 * Checking resolvability rather than "does it end in .ts" keeps this about the property that matters
 * — a bare package specifier like `lindera-nodejs` is fine precisely because it resolves.
 */

const repoRoot = resolve(import.meta.dirname, "../..");

/**
 * Runtime relative imports/re-exports in one file's source.
 *
 * `import type {...} from "x"` is erased before Node sees it, so it cannot fail to resolve and is
 * excluded. A mixed `import { type A, b }` is NOT erased — it still loads the module for `b` — so
 * only the leading `import type` form is skipped.
 */
const runtimeRelativeSpecifiers = (source: string): string[] => {
  const out: string[] = [];
  const statement =
    /^\s*(?:import|export)(?<typeOnly>\s+type)?\s[^'"\n]*?from\s*["'](?<spec>\.[^"']*)["']/gmu;
  for (const match of source.matchAll(statement)) {
    const { typeOnly, spec } = match.groups ?? {};
    if (typeOnly === undefined && spec !== undefined) out.push(spec);
  }
  return out;
};

/** Walk out from the build scripts, collecting every unresolvable runtime import found on the way. */
const unresolvable = (entries: string[]): string[] => {
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    for (const spec of runtimeRelativeSpecifiers(readFileSync(file, "utf8"))) {
      const target = join(dirname(file), spec);
      if (!existsSync(target)) {
        problems.push(
          `${relative(repoRoot, file)} imports "${spec}", which plain Node cannot resolve — ` +
            `add the file extension (e.g. "${spec}.ts")`
        );
        continue;
      }
      if (target.endsWith(".ts") || target.endsWith(".mts")) queue.push(target);
    }
  }
  return problems;
};

describe("build script module graph", () => {
  it("resolves under plain Node, not just under the bundler", () => {
    // WHY: `vp run build:data` runs these through Node directly. An extensionless relative import
    // anywhere in their reach is a release-blocking crash that every other check passes over —
    // `vp check` type-checks it fine and `vp test` never loads it through Node's resolver.
    const scripts = globSync("scripts/*.ts", { cwd: repoRoot }).map((p) =>
      join(repoRoot, p)
    );
    expect(scripts.length).toBeGreaterThan(0);
    expect(unresolvable(scripts)).toEqual([]);
  });
});
