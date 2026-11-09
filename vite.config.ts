import { execSync } from "node:child_process";
import { defineConfig, configDefaults } from "vite-plus";
import type { TestProjectConfiguration } from "vite-plus";
import { lint, fmt, mergeLint } from "@saeris/configs";
import react from "@vitejs/plugin-react";
import { playwright } from "vite-plus/test/browser/providers/playwright";
import { deoptKit } from "deoptkit/vitest";
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

/** deoptkit's log categories, for validating `DEOPTKIT_CATEGORIES` rather than asserting it. */
const LOG_CATEGORIES = ["ics", "deopts", "maps", "profile", "sources"] as const;
const isLogCategory = (
  value: string
): value is (typeof LOG_CATEGORIES)[number] =>
  (LOG_CATEGORIES as readonly string[]).includes(value);

/**
 * Whether this invocation is `vp test bench` rather than a plain `vp test`.
 *
 * `benchmark.enabled` has to be BOTH on in bench mode (it is what registers the project — bench
 * mode filters to the projects that opt in, before `--project` is applied) and off otherwise: left
 * unconditionally true, the benchmarks also run during an ordinary `vp test`.
 *
 * That is not merely slow. `recognize.bench.ts` imports `patterns.ts`, which decodes with
 * `Uint8Array.fromBase64` — a BROWSER API (Chromium 148, Node 25+). CI runs the suite on Node
 * 24.15, so a plain `vp test` there died with "Uint8Array.fromBase64 is not a function", while the
 * same command passed locally on Node 26 purely because the newer runtime happens to have it.
 *
 * Read from argv because Vitest's own `benchmarkOnly` is a CLI option, resolved after this config
 * is evaluated and not reachable from here.
 */
const IS_BENCH_RUN = process.argv.includes("bench");

/**
 * `.ts` specs that must run in the browser project despite not rendering anything, because the code
 * under test uses an API the extension host's Node does not have.
 *
 * Keep this list short and justified — the default remains that pure logic is tested in Node, which
 * starts faster. `vi.resetModules()` also does not re-execute a module in browser mode (the native
 * ESM registry cannot be invalidated), so a spec that re-imports to reset module state cannot move
 * here.
 */
const BROWSER_ONLY = [
  // `patterns.ts` decodes with `Uint8Array.fromBase64` (Chromium 148 / Node 25+).
  "src/webview/recognizer/__tests__/recognize.spec.ts",
  // `webviewShortcuts.ts` builds an `InputEvent` carrying a `DataTransfer` — both DOM constructors,
  // and the point of the module is that a REAL element consumes the event it dispatches.
  "src/webview/components/__tests__/webviewShortcuts.spec.ts"
];

/**
 * Pure logic, in Node.
 *
 * `.ts` only: anything rendering a component is `.tsx` and belongs to `componentProject`, so the
 * extension is the boundary and no exclude list has to restate it.
 *
 * The exception is `BROWSER_ONLY`. The two runtimes we ship to are not interchangeable — the
 * webview's Chromium 148 has `Uint8Array.fromBase64`, the extension host's Node 24 does not (it
 * landed in Node 25) — so webview code using a browser-only API cannot be exercised under Node
 * even when the code itself is pure logic. Those specs move to the browser project, where the
 * environment matches production.
 */
const unitProject: TestProjectConfiguration = {
  test: {
    name: "unit",
    // `scripts/` too: the data-build transforms are pure functions and belong at this layer.
    include: ["src/**/*.{test,spec}.ts", "scripts/**/*.{test,spec}.ts"],
    exclude: [...configDefaults.exclude, NOT_BENCH, ...BROWSER_ONLY],
    // Vitest v5 gives EVERY project a bench variant, and a variant resolves `benchmark.include`
    // on its own — the project's `exclude` above does not constrain it. Left unset it defaults to
    // `**/*.bench.*`, so this project would claim bench/ in bench mode despite NOT_BENCH. Empty
    // means "this project contributes no benchmarks", which is the truth: they all live in `bench`.
    benchmark: { include: [] },
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
    // Everything that renders, plus the `BROWSER_ONLY` logic specs whose code needs a browser API.
    include: ["src/**/*.{test,spec}.tsx", ...BROWSER_ONLY],
    exclude: [...configDefaults.exclude, NOT_BENCH],
    // See the unit project: a bench variant resolves `benchmark.include` independently of
    // `exclude`. Unset, this project pulled `bench/**` into a CHROMIUM tab — including the
    // `*.bench.mjs` deoptkit workloads, which are not Vitest suites and failed on an unresolvable
    // `deoptkit/harness` import.
    benchmark: { include: [] },
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
    /**
     * `include` stays EMPTY, and under Vitest v5 that matters more than it used to.
     *
     * A bench is now a `test()` carrying a `bench` fixture, so these files ARE collectable tests.
     * Naming them here makes a plain `vp test` (what CI runs) pick them up and fail 23 times with
     * "Cannot use the `bench` test-context fixture within a regular test run" — Vitest refuses to
     * measure outside bench mode, deliberately, because benchmarks are flaky under a test runner.
     *
     * `benchmark.include` below is what claims these files, and only in bench mode.
     *
     * Only `.ts`: the sibling `*.bench.mjs` files are deoptkit PROFILING workloads, run under V8
     * logging flags rather than by Vitest — they export no Vitest suite at all.
     */
    include: [],
    /**
     * `enabled` is what makes `vp run bench` find this project at all.
     *
     * In bench mode Vitest keeps only the projects that opt in —
     * `projects.filter((p) => p.config.benchmark.enabled)` — and that filter runs BEFORE the
     * `--project bench` name filter. Without this the run failed with "No projects matched the
     * filter \"bench\"" while `vp test list` happily reported `[bench]`, which is a confusing pair
     * of answers to get from one config.
     */
    benchmark: { enabled: IS_BENCH_RUN, include: ["bench/**/*.bench.ts"] },
    environment: "node",
    /**
     * `vp run bench:profile` runs the same benches under V8 optimization logging (deoptkit).
     *
     * Opt-in, never the default: logging slows every case, so a baseline recorded under it would
     * make each later `bench:compare` read as a regression. The preset forces the forks pool and
     * writes one log per worker plus `.deopt/manifest.json` and `.deopt/findings.json`, which
     * `deoptkit lsp` shows as diagnostics. Each case is windowed by `benchObserved`, so findings
     * can be scoped to it. See bench/README.md.
     */
    //
    // `DEOPTKIT_CATEGORIES` narrows what is logged. Everything is the default and right for the
    // microsecond cases, but a workload that walks hundreds of thousands of rows logs an inline-cache
    // event per property access: profiling `refineCounts` that way wrote 8.4 GB before it was
    // stopped. `deopts,profile,sources` keeps the ticks — which answer "where does the time go" —
    // and drops the IC and map firehose.
    ...(process.env.DEOPTKIT === "1"
      ? deoptKit({
          outDir: ".deopt",
          categories:
            process.env.DEOPTKIT_CATEGORIES?.split(",").filter(isLogCategory)
        })
      : {})
  }
};

/**
 * The commit this bundle was built from, stamped in at build time.
 *
 * Crash reports need to name a BUILD, not just a version: a republished version is otherwise
 * indistinguishable from the original, and "1.0.0" then covers several different sets of code.
 * `process.env` is no help at runtime — the packaged extension is a static bundle with no CI
 * environment around it — so the value has to be baked in here.
 *
 * `GITHUB_SHA` in CI, the local checkout otherwise, and `"dev"` when neither is available (a
 * tarball with no git directory). Never throws: a build must not fail because the commit is
 * unknowable, and "dev" is an honest answer.
 */
const buildCommit = (): string => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "dev";
  }
};

/** Shared by both bundles, so the host and the webview always report the same build. */
const BUILD_DEFINE = {
  __JISHO_COMMIT__: JSON.stringify(buildCommit())
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
        // Throughput benchmarks joined this list in Vitest v5. A bench used to be its own
        // construct; it is now a `test()` carrying a `bench` fixture, so every benchmark reads to
        // the rule as a test that forgot to assert. It did not forget — a bench MEASURES, and the
        // numbers are the output. Adding a token `expect` to 23 benchmarks to satisfy a rule would
        // be worse than scoping the rule.
        files: ["src/**/*.preview.spec.tsx", "bench/**/*.bench.ts"],
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
  define: BUILD_DEFINE,
  build: {
    // `engines.vscode ^1.123` resolves to exactly one renderer — Chromium 148 — so the browser
    // matrix is a single point and the default (`baseline-widely-available`, i.e. Chrome 111)
    // down-levels for browsers that can never run this code. Stated rather than inferred: without
    // it, a toolchain default shifting under us is a silent output change, not a reviewable one.
    target: "chrome148",
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
    // The extension host is Node, not the renderer — a different runtime from the webview above and
    // so a different target. VSCode 1.123 ships Node 24; `node24` is the floor, not the Node that
    // happens to run the build.
    target: "node24",
    // The same stamp as the webview above: a report names one build, whichever side raised it.
    define: BUILD_DEFINE,
    clean: false, // don't wipe dist/webview (built separately by `vp build`)
    format: [`cjs`],
    dts: false,
    outDir: `./dist`,
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
      // `vscode` is provided by the host at runtime — never bundle it.
      // `lindera-nodejs` loads a platform-specific .node addon by package name at
      // runtime, so it and the `lindera-nodejs-*` platform packages must stay
      // unbundled in node_modules.
      // (The database needs no entry here: `node:sqlite` is a built-in module.)
      neverBundle: ["vscode", /lindera-nodejs/],
      alwaysBundle: ["vscode-textmate", "vscode-oniguruma"]
    }
  },
  // ── Testing (Vitest) ────────────────────────────────────────────────
  // See the project definitions above for why this is split three ways.
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    //
    // `sharedViteServer: false` was the OTHER compatibility setting `vp migrate` added here, and it
    // is deliberately absent: it broke 72 tests. The projects above carry no `plugins` of their own
    // and inherit the top-level `react()` (see the note beside them), so giving each its own Vite
    // server left the component project with a second copy of React — every render died on
    // "Cannot read properties of null (reading 'useContext')". v5's shared server is what this
    // config already assumed.
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
