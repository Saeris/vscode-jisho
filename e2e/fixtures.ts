import { test as base } from "@playwright/test";
import type { FrameLocator } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import {
  fillSearch,
  jishoFrame,
  openJishoSidebar,
  returnToSearch
} from "./webview";

/**
 * One VS Code, shared by every spec that wants a default launch.
 *
 * The suite runs with `workers: 1` and `fullyParallel: false` — forced, since there is a single debug
 * port — so a WORKER-scoped fixture launches once for the entire run rather than once per file. That
 * is what makes per-feature spec files affordable: splitting by feature used to mean paying another
 * ~8s boot per file, which is why BACKLOG #49's restructure was deferred. It no longer does.
 *
 * `settings.e2e.ts` deliberately does NOT use this. It seeds `vscode-jisho.*` configuration at launch,
 * and settings that must exist before the extension activates cannot be applied to an instance that is
 * already running. A separate launch is the honest way to express that, and it is the one case a
 * shared fixture cannot serve.
 *
 * The fixture launches only — it does not open the sidebar. `openJishoSidebar` means "ensure open"
 * rather than "toggle", so specs call it where they need it, and none of them depend on having been
 * handed a particular starting view.
 *
 * CONSEQUENCE worth knowing: sharing an instance means workbench state (the open view, the last
 * search) now survives ACROSS files, not just across tests within one. Every spec already resets what
 * it needs via `openJishoSidebar`/`returnToSearch`, because they had to do that within a file
 * already; this widens the blast radius of forgetting to.
 */
export const test = base.extend<{ jisho: FrameLocator }, { vscode: Launched }>({
  vscode: [
    // The empty destructure is Playwright's fixture signature: this fixture depends on none of the
    // others, but the parameter position is still where dependencies would be declared.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use: (app: Launched) => Promise<void>): Promise<void> => {
      const app = await launchVSCode();
      await use(app);
      await app.close();
    },
    { scope: "worker" }
  ],

  /**
   * The Jisho webview, reset to an empty search view.
   *
   * Test-scoped, so it runs per test and only for tests that ask for it — an editor-command test that
   * never touches the sidebar pays nothing. It exists because sharing one VS Code means a detail view
   * or a stale query now survives across FILES: the first capture in `visual` started failing the
   * moment it stopped getting a fresh instance, because an earlier file had left a word page open.
   *
   * Resetting here rather than in each test is what makes the per-feature split safe. Otherwise every
   * new file would silently depend on which files happened to run before it.
   */
  jisho: async ({ vscode }, use: (frame: FrameLocator) => Promise<void>) => {
    await openJishoSidebar(vscode.window);
    const frame = await jishoFrame(vscode.window);
    await returnToSearch(frame);
    await fillSearch(frame, "");
    await use(frame);
  }
});

export { expect } from "@playwright/test";
