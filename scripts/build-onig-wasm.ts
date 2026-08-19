/**
 * Provision the oniguruma WASM into `assets/onig.wasm`.
 *
 * Run after a dependency change, not per-build:  vp run build:onig-wasm
 *
 * `vscode-textmate` runs a TextMate grammar to find the comments in a code file (spec 18), and its
 * regex engine is a WASM binary that `vscode-oniguruma` ships but does not embed — the loader is
 * handed the bytes. Bundling the JS therefore does not bring the `.wasm` along, so it is copied
 * into `assets/` where the extension reads it through `vscode.workspace.fs`, the same way the
 * stroke SVGs and the tokenizer dictionary are delivered.
 *
 * Copied rather than imported as a bundler asset deliberately: `vscode.workspace.fs` works in the
 * web extension host too (spec 06), so one delivery path serves both. Gitignored — a provisioned
 * build artifact, not source.
 *
 * The version is not pinned here. It follows the `vscode-oniguruma` dependency, and re-running this
 * after a bump is what keeps the two in step; `src/__tests__/onig-wasm.spec.ts` fails when they
 * drift.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "assets", "onig.wasm");

// Resolved through the package rather than by a hardcoded path into node_modules, so a change to
// the dependency's layout surfaces as a clear resolution error instead of a missing file.
const require = createRequire(import.meta.url);
const source = join(
  dirname(require.resolve("vscode-oniguruma/package.json")),
  "release",
  "onig.wasm"
);

if (!existsSync(source))
  throw new Error(
    `vscode-oniguruma does not ship a wasm at ${source} — check the package layout after the bump.`
  );

mkdirSync(dirname(OUT), { recursive: true });
copyFileSync(source, OUT);
console.log(
  `Copied onig.wasm to assets/ (${(statSync(OUT).size / 1024).toFixed(0)} KB).`
);
