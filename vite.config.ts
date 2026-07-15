import { defineConfig, configDefaults } from "vite-plus";
import type { TestProjectConfiguration } from "vitest/config";
import { lint, fmt, mergeLint } from "@saeris/configs";
import react from "@vitejs/plugin-react";
import { playwright } from "vite-plus/test/browser/providers/playwright";
import manifest from "./package.json" with { type: "json" };

// ── Test projects ─────────────────────────────────────────────────────
// Split by what each test actually needs, so the cheap layers stay cheap:
//
//  • "unit"      — pure logic (pitch geometry, recognizer, host query layer). Node, no DOM.
//  • "component" — React components in jsdom. Fast, but jsdom has no layout engine: it reports
//                  zero-size boxes and no real style resolution.
//  • "browser"   — React components in a REAL Chromium. The only layer that can see LAYOUT, which
//                  is where the visual bugs actually live. The pitch contour shipped broken twice
//                  with green jsdom tests: first a per-mora border approach that couldn't draw a
//                  connected line, then an SVG that silently collapsed to ~3px because an abspos
//                  child of a grid resolves against its grid area. Neither is observable without a
//                  layout engine — hence a browser project rather than more jsdom.
//
// The E2E suite (e2e/*.e2e.ts, Playwright driving real VS Code) is deliberately NOT a vitest
// project: it verifies the whole extension, not components in isolation, and is far too slow to sit
// in the iteration loop.
//
// None of these carry their own `plugins` — they inherit the top-level react() below. Repeating it
// per project is what TypeScript can't typecheck: comparing a project literal containing Vite's
// Plugin type against TestProjectConfiguration overflows its recursion limit ("excessive stack
// depth"), whatever the annotation.
const unitProject: TestProjectConfiguration = {
  test: {
    name: "unit",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: [...configDefaults.exclude, "**/*.browser.{test,spec}.{ts,tsx}"],
    environment: "node"
  }
};

const componentProject: TestProjectConfiguration = {
  test: {
    name: "component",
    include: ["src/**/*.{test,spec}.tsx"],
    exclude: [...configDefaults.exclude, "**/*.browser.{test,spec}.{ts,tsx}"],
    environment: "jsdom"
  }
};

const browserProject: TestProjectConfiguration = {
  test: {
    name: "browser",
    include: ["src/**/*.browser.{test,spec}.{ts,tsx}"],
    exclude: [...configDefaults.exclude],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }]
    }
  }
};

export default defineConfig({
  lint: mergeLint(lint, {
    // Preview benches render a component's variants and screenshot them for visual review — they're
    // a bench, not a test, so `expect-expect` rightly finds no assertions. The correctness they'd
    // otherwise assert lives in the sibling *.browser.spec.tsx.
    ignorePatterns: ["src/**/*.preview.browser.spec.tsx"]
  }),
  fmt,
  // ── Webview app build (Vite / Rolldown, via `vp build`) ──────────────
  // The React sidebar UI runs in a webview (a browser context), so it is a
  // Vite *application* build — separate from the extension-host bundle below.
  // Stable, hash-free output names let extension.ts reference them directly.
  plugins: [...react()],
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
  // See the project definitions above for why this is split three ways.
  test: {
    name: manifest.name,
    globals: true,
    passWithNoTests: true,
    projects: [unitProject, componentProject, browserProject]
  }
});
