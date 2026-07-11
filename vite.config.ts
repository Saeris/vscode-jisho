import { defineConfig } from "vite-plus";
import { lint, fmt } from "@saeris/configs";
import react from "@vitejs/plugin-react";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  lint,
  fmt,
  // ── Webview app build (Vite / Rolldown, via `vp build`) ──────────────
  // The React sidebar UI runs in a webview (a browser context), so it is a
  // Vite *application* build — separate from the extension-host bundle below.
  // Stable, hash-free output names let extension.ts reference them directly.
  plugins: [react()],
  build: {
    outDir: "dist/webview",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/webview/index.tsx",
      output: {
        entryFileNames: "index.js",
        assetFileNames: "index.[ext]"
      }
    }
  },
  // ── Extension host bundle (tsdown, via `vp pack`) ────────────────────
  // VSCode loads extensions as CommonJS in its extension host, so we emit a
  // single bundled .cjs (no .d.ts — extensions aren't consumed as a library).
  pack: {
    entry: ["src/extension.ts"],
    clean: false, // don't wipe dist/webview (built separately by `vp build`)
    format: [`cjs`],
    dts: false,
    outDir: `./dist`,
    deps: {
      // `vscode` is provided by the host at runtime — never bundle it.
      // `@tursodatabase/database` loads a platform-specific native .node addon via
      // its own resolver; it must stay unbundled and ship in node_modules.
      // `lindera-wasm-nodejs-ipadic` reads its .wasm from its own __dirname at runtime,
      // so it likewise must stay unbundled.
      neverBundle: [
        "vscode",
        /^@tursodatabase\//,
        "lindera-wasm-nodejs-ipadic"
      ],
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
