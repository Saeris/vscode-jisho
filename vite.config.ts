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
//  • "component" — anything that renders, in a REAL Chromium. Layout is where the visual bugs live:
//                  the pitch contour shipped broken twice under jsdom, first a per-mora border
//                  approach that couldn't draw a connected line, then an SVG that silently collapsed
//                  to ~3px because an abspos child of a grid resolves against its grid area.
//
// The E2E suite (e2e/*.e2e.ts, Playwright driving real VS Code) is deliberately NOT a vitest
// project: it verifies the whole extension, not components in isolation, and is far too slow to sit
// in the iteration loop.
//
// None of these carry their own `plugins` — they inherit the top-level react() below. Repeating it
// per project is what TypeScript can't typecheck: comparing a project literal containing Vite's
// Plugin type against TestProjectConfiguration overflows its recursion limit ("excessive stack
// depth"), whatever the annotation.
// Every project must exclude `bench/`: Vitest runs benchmark files in ANY project whose include
// pattern matches them, so without this the benchmarks execute once per project — three redundant
// runs, and results from an environment (a real browser) the numbers do not claim to describe.
const NOT_BENCH = "bench/**";

const unitProject: TestProjectConfiguration = {
  test: {
    name: "unit",
    // `scripts/` too: the data-build transforms are pure functions and belong at this layer.
    // Only `.ts`: anything rendering a component is `.tsx` and belongs to the `component` project, so
    // the extension IS the boundary — no exclude list has to restate it.
    include: ["src/**/*.{test,spec}.ts", "scripts/**/*.{test,spec}.ts"],
    exclude: [...configDefaults.exclude, NOT_BENCH],
    environment: "node"
  }
};

/**
 * Component tests, in a real Chromium via Playwright.
 *
 * This was two projects — `component` under jsdom and `browser` for the specs that needed real
 * layout — which is a split with no upside once the whole layer runs in a browser anyway. Measured
 * before merging: jsdom spent 38s of cumulative environment setup to make 54 tests take 10.1s, while
 * the same 54 tests take 1.9s in Chromium. The browser costs more to START and less to RUN, and the
 * full suite came out at 27.3s either way.
 *
 * What the split cost: a `@vitest-environment jsdom` pragma that eight of thirteen files carried and
 * five didn't, two exclude patterns restating the naming convention, and — because only one of the
 * two projects had `setupFiles` — browser specs hand-rolling the `acquireVsCodeApi` stub through
 * `vi.hoisted` plus a dynamic import, to reproduce what the other project got for free.
 *
 * jsdom is also not a browser: it reimplements DOM APIs in Node, so an event or a layout question it
 * answers differently from Chromium is a test result that describes jsdom rather than the product.
 */
const componentProject: TestProjectConfiguration = {
  test: {
    name: "component",
    include: ["src/**/*.{test,spec}.tsx"],
    exclude: [...configDefaults.exclude, NOT_BENCH],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }]
    },
    // Stubs `acquireVsCodeApi` (bridge.ts calls it at module load) and registers cleanup between
    // tests. A property of the project rather than a preamble each spec remembers.
    setupFiles: ["src/webview/__tests__/setup.ts"]
  }
};

/**
 * Throughput benchmarks (`vp test bench`). Separate from the test projects because these answer a
 * different question: deoptkit explains WHY a path is slow, while these measure WHETHER a change
 * made it faster — the before/after signal that can gate a regression.
 *
 * Node environment: every benchmarked path is host-side or pure logic, and jsdom would add overhead
 * to the measurement without adding realism.
 */
const benchProject: TestProjectConfiguration = {
  test: {
    name: "bench",
    // `include` is deliberately EMPTY: these files contain benches, not tests, so a plain
    // `vp test` (what CI runs) must not try to collect them — it would fail with "No test suite
    // found". Only `benchmark.include` claims them, which `vp test bench` reads.
    include: [],
    // Only .ts: the sibling `*.bench.mjs` files are deoptkit PROFILING workloads, run under V8
    // logging flags rather than by Vitest — they export no Vitest suite at all.
    benchmark: { include: ["bench/**/*.bench.ts"] },
    environment: "node"
  }
};

export default defineConfig({
  lint: mergeLint(lint, {
    // Preview benches render a component's variants and screenshot them for visual review — they're
    // a bench, not a test, so `expect-expect` rightly finds no assertions. The correctness they'd
    // otherwise assert lives in the sibling *.browser.spec.tsx.
    //
    // Scoped to the ONE rule, not the file. This was `ignorePatterns` and that silently dropped these
    // files from TYPE checking as well: a preview fixture went on constructing a DTO with a field the
    // interface no longer had, `vp check` stayed green, and the failure surfaced as a runtime
    // `Cannot read properties of undefined` in the browser project instead of as a type error.
    overrides: [
      {
        files: ["src/**/*.preview.spec.tsx"],
        rules: { "vitest/expect-expect": "off" }
      },
      {
        // Palette research scripts (docs/palette-tools) are standalone numerical tools, not
        // extension code — they never ship and are run by hand. The idioms flagged here are
        // deliberate in that context: `| 0` for fast integer coercion in an annealing inner loop,
        // `continue` to reject an invalid neighbour move, `undefined` as an explicit sentinel.
        // Scoped to the RULES rather than dropping the files, so type checking still applies.
        files: ["docs/palette-tools/**/*.mjs"],
        rules: {
          "eslint/no-bitwise": "off",
          "eslint/no-continue": "off",
          "eslint/no-undefined": "off",
          "eslint/no-shadow": "off",
          "import/first": "off"
        }
      }
    ]
  }),
  fmt: {
    ...fmt,
    // The compiled IPADIC tokenizer dictionary is a vendored build artifact (incl. metadata.json);
    // it must not be reformatted. See docs/specs/14.
    //
    // The palette documents are GENERATED (docs/palette-tools/gen-palettes.mjs) and carry inline
    // <style> blocks whose formatting the generator owns; reformatting them here would be undone by
    // the next run. Their generated JSON is likewise machine-written.
    ignorePatterns: [
      ...(fmt.ignorePatterns ?? []),
      "assets/lindera-ipadic/**",
      "docs/pos-palette-comparison.md",
      "docs/pos-palettes.md",
      "docs/pos-palettes-review.md",
      "docs/palette-tools/*.json",
      // Generated by `vp run build:pos-css`; reformatting it here would be undone by the next run.
      "src/webview/styles/posPalette.css"
    ]
  },
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
      // `lindera-nodejs` loads a platform-specific .node addon by package name at
      // runtime, so it and the `lindera-nodejs-*` platform packages must stay
      // unbundled in node_modules.
      // (The database needs no entry here: `node:sqlite` is a built-in module.)
      neverBundle: ["vscode", /lindera-nodejs/],
      alwaysBundle: []
    }
  },
  // ── Testing (Vitest) ────────────────────────────────────────────────
  // See the project definitions above for why this is split three ways.
  test: {
    name: manifest.name,
    globals: true,
    passWithNoTests: true,
    // Mock hygiene as configuration rather than per-file discipline. Mock state (call history AND
    // implementation) otherwise leaks between tests in a file, which produces the worst failure mode
    // there is: a test that passes alone and fails in suite, or vice versa.
    //   mockReset    — clears calls and removes implementations between tests
    //   restoreMocks — puts spied-on originals back
    //   unstubGlobals/unstubEnvs — undoes vi.stubGlobal / vi.stubEnv
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    projects: [unitProject, componentProject, benchProject]
  }
});
