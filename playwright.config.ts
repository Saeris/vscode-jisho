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
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
