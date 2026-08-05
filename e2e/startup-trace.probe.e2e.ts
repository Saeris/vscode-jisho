import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchVSCode } from "./launch";
import { fillSearch, jishoFrame, openJishoSidebar } from "./webview";

/** Recursively find the most recent `Jisho.log` under a VS Code profile's logs directory. */
const findJishoLog = (root: string): string | undefined => {
  let best: { path: string; at: number } | undefined;
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full);
      else if (/jisho.*\.log$/i.test(name)) {
        if (best === undefined || stat.mtimeMs > best.at) {
          best = { path: full, at: stat.mtimeMs };
        }
      }
    }
  };
  walk(root);
  return best === undefined ? undefined : readFileSync(best.path, "utf8");
};

/**
 * COLD-START measurement, on its own VS Code instance.
 *
 * The shared `vscode` fixture launches once for the whole run, so by the time any spec searches, the
 * dictionary is open and the tokenizer is warm — the exact costs a user pays on their FIRST search
 * are invisible to it. This spec launches its own instance, performs one search, and prints the
 * host's startup trace (`vscode-jisho.showStartupTrace`), which reports each step's duration, the
 * dead gaps between them, and — critically for the synchronous SQLite driver — how long the event
 * loop was blocked.
 *
 * Diagnostic, not an assertion: it prints. Wall-clock thresholds on a real VS Code launch flake on a
 * loaded machine, so this reports numbers for a human to read rather than failing a build.
 */
test("cold start: trace the first search", async () => {
  const app = await launchVSCode();
  try {
    const started = Date.now();
    await openJishoSidebar(app.window);
    const frame = await jishoFrame(app.window);
    const sidebarReady = Date.now() - started;

    const searchStarted = Date.now();
    await fillSearch(frame, "食べる");
    await expect(frame.getByText("to eat").first()).toBeVisible({
      timeout: 60_000
    });
    const firstSearch = Date.now() - searchStarted;

    // Second search on an already-open dictionary: the difference between the two is the cold cost.
    const warmStarted = Date.now();
    await fillSearch(frame, "水");
    await expect(frame.getByText("water").first()).toBeVisible({
      timeout: 60_000
    });
    const warmSearch = Date.now() - warmStarted;

    console.log(`\n=== COLD START (wall clock, includes UI render) ===`);
    console.log(`  sidebar ready:      ${sidebarReady}ms`);
    console.log(`  FIRST search:       ${firstSearch}ms`);
    console.log(`  second search:      ${warmSearch}ms`);
    console.log(`  cold penalty:       ${firstSearch - warmSearch}ms\n`);

    // The host's per-step timings, read from the log FILE the "Jisho" output channel writes
    // (`createOutputChannel(..., { log: true })`). Reading the file beats driving the Output panel:
    // the panel virtualises its lines, so scraping the DOM returns only what is scrolled into view.
    const logs = findJishoLog(app.userDataDir);
    console.log("=== HOST LOG (Jisho channel) ===");
    console.log(logs ?? "(no Jisho log file found)");
  } finally {
    await app.close();
  }
});
