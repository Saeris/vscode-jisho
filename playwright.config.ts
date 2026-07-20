import { defineConfig } from "@playwright/test";

/**
 * E2E config: drives a real VS Code (Electron) with our extension loaded. Separate from the Vitest
 * unit/component suites — run with `vp run e2e` (or `npx playwright test`). Serialized because each
 * test launches its own VS Code instance (heavy); no parallelism keeps it deterministic and avoids
 * multiple VS Code downloads racing.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  // The test timeout has to cover a cold VS Code launch (download check, Electron boot, extension
  // host start), which is genuinely slow — hence 120s.
  //
  // The expect/action timeout is a different question and was tuned as if it were the same one. A
  // missing element is knowable in seconds, so a 30s default mostly buys dead waiting: a single
  // wrong locator in the handwriting capture burned the full 120s test timeout, which cost more
  // wall clock than the rest of the suite combined. 10s still absorbs a slow first render (the
  // helpers that genuinely need longer — reaching the webview iframes — pass their own 30s).
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    // Same reasoning as the expect timeout: a click that cannot find its target should fail fast
    // rather than sit until the test timeout.
    actionTimeout: 10_000,
    screenshot: "only-on-failure",
    // Tracing is OFF, and that is a deliberate trade rather than an oversight.
    //
    // `retain-on-failure` still records a trace for every test and discards it on pass. This
    // harness connects over CDP to a VS Code that it launches and kills per suite, so tracing's
    // temp artifacts get torn down underneath it and the TEARDOWN throws — surfacing as failures
    // that have nothing to do with the assertions: "Cannot read properties of undefined (reading
    // 'traceName')", "ENOENT ... playwright-artifacts-*", "not a zip file, or file is truncated".
    // Those were the whole of the cross-suite interference: the same specs pass in isolation and
    // fail in a full run, which reads as flakiness and trains everyone to ignore red.
    //
    // It is also self-defeating — the trace you would want for a genuine failure is exactly the
    // artifact that gets corrupted. `screenshot: "only-on-failure"` and Playwright's error-context
    // snapshot survive the teardown and are what actually diagnosed every bug in this suite so far.
    // Turn tracing back on per-run when you need it (`--trace on`), against a single spec.
    trace: "off"
  }
});
