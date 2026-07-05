import { defineConfig } from "vite-plus";
import { lint, fmt } from "@saeris/configs";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  lint,
  fmt,
  // ── Builds (tsdown) ─────────────────────────────────────────────────
  // VSCode loads extensions as CommonJS in its extension host, so we emit a
  // single bundled .cjs (no .d.ts — extensions aren't consumed as a library).
  // `alwaysBundle` pulls runtime deps into the artifact so the packaged .vsix
  // is self-contained; add matchers here for anything the extension imports.
  pack: {
    entry: ["src/index.ts"],
    clean: true,
    format: [`cjs`],
    dts: false,
    outDir: `./dist`,
    deps: {
      // `vscode` is provided by the host at runtime — never bundle it.
      neverBundle: ["vscode"],
      alwaysBundle: []
    }
  },
  // ── Testing (Vitest) ────────────────────────────────────────────────
  test: {
    name: manifest.name,
    globals: true,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    passWithNoTests: true
  }
});
