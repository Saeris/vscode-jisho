/**
 * Launch a real VS Code with our extension loaded, driven by Playwright over Chromium's CDP.
 *
 * We do NOT use Playwright's `_electron.launch` — it makes Electron-app assumptions VS Code's
 * bespoke launcher rejects ("Process failed to launch"). Instead we spawn `Code.exe` ourselves with
 * `--remote-debugging-port`, then attach Playwright via `chromium.connectOverCDP`. This is the
 * robust, cross-platform pattern for driving VS Code's webviews.
 *
 * `@vscode/test-electron` resolves/downloads the binary; `--extensionDevelopmentPath=<repo>` makes
 * the extension's `context.extensionUri` the repo, so `ensureDatabase` uses the local
 * assets/jisho.db (no 320MB download). A throwaway user-data + workspace keeps runs isolated.
 *
 * SAFETY — this harness drives a real browser process, so two rules are non-negotiable:
 *  1. **Never `browser.close()`.** Over a CDP *attach*, close() shuts the target down. An earlier
 *     version did this and closed the developer's actual VS Code windows. Cleanup is PID-only: we
 *     kill the process we spawned and let the socket drop.
 *  2. **Never attach to a port we didn't open.** We refuse to start if the debug port is already
 *     serving a CDP endpoint, so we can't accidentally drive someone else's editor/debug session.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { type Browser, type Page, chromium } from "@playwright/test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * PINNED, not "stable". `downloadAndUnzipVSCode("stable")` re-resolves on every run, so a VS Code
 * release silently swaps the binary (and re-downloads 224MB) under a suite that was green an hour
 * ago. Pin it so runs are reproducible and version bumps are a deliberate, reviewable change.
 */
const VSCODE_VERSION = "1.128.1";
// A deliberately uncommon port. NOT 9229 (Node's default inspector) or 9222 (Chrome's default) —
// attaching to a port some other process already owns risks driving/closing the user's real editor
// or a debug session. We additionally verify the endpoint is OUR spawned process before using it.
export const DEBUG_PORT = 39871;

/**
 * The two stock themes the capture suites audit against. Both ship in every VS Code install, so no
 * suite depends on a marketplace extension being present.
 *
 * `workbenchClass` is what makes a theme switch AWAITABLE: VS Code stamps the active theme's kind
 * onto `.monaco-workbench`, so "the theme is now light" is a selector rather than a timeout.
 */
const THEMES = {
  dark: { name: "Default Dark Modern", workbenchClass: "vs-dark" },
  light: { name: "Default Light Modern", workbenchClass: "vs" }
} as const;

export type ThemeKind = keyof typeof THEMES;

export interface Launched {
  browser: Browser;
  /** The temp profile dir — its `logs/` subtree holds the extension's output-channel log files. */
  userDataDir: string;
  /** The main VS Code workbench window as a Playwright Page. */
  window: Page;
  /**
   * The throwaway folder VS Code opened as its workspace.
   *
   * Exposed for the documentation screenshots, which write fixture files into it so the editor has
   * realistic Japanese text to hover and highlight. Empty for every other suite.
   */
  workspaceDir: string;
  /**
   * Switch themes in place, so one launch can capture both passes.
   *
   * Rewrites the profile's `settings.json` and waits for the workbench to report the new theme kind.
   * VS Code watches that file, which is why this works where driving the theme PICKER did not: the
   * picker races quick-input focus (focus lives inside our webview, and the palette steps outran it),
   * whereas a file write has a settled end state to wait for.
   */
  setTheme: (kind: ThemeKind) => Promise<void>;
  close: () => Promise<void>;
}

const wait = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

/**
 * Kill the process tree rooted at `pid` — and ONLY that tree.
 *
 * VS Code spawns a tree (main + renderers + extension host); signalling just the launcher leaves
 * survivors that keep file handles on the install/profile and break subsequent launches. Windows
 * has no process-group signal, so we use taskkill /T (tree) /F, scoped to our own PID.
 */
const killTree = (pid: number): void => {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore"
      });
    } else {
      process.kill(-pid, "SIGKILL"); // negative pid = the process group we spawned
    }
  } catch {
    // Best-effort: the tree may already be gone.
  }
};

/** Poll the CDP endpoint until VS Code is ready to accept a connection. */
const connectWithRetry = async (): Promise<Browser> => {
  const deadline = Date.now() + 60_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    } catch (err) {
      lastErr = err;
      await wait(500);
    }
  }
  throw new Error(`Could not connect to VS Code CDP: ${String(lastErr)}`);
};

/**
 * Pre-seed the throwaway user-data dir with settings that suppress first-run noise. A brand-new
 * profile otherwise shows onboarding and a Settings-Sync sign-in modal, which overlays the
 * workbench — breaking clicks and contaminating screenshots. Seeding is deterministic; dismissing
 * modals after the fact would be racy and version-fragile.
 */
const seedUserData = (
  userDataDir: string,
  settings: Record<string, unknown> = {}
): void => {
  const userDir = join(userDataDir, "User");
  mkdirSync(userDir, { recursive: true });
  writeFileSync(
    join(userDir, "settings.json"),
    JSON.stringify(
      {
        ...settings,
        // No sign-in / sync prompts.
        "settingsSync.keybindingsPerPlatform": false,
        "workbench.settings.enableNaturalLanguageSearch": false,
        // No welcome/startup surfaces competing with our view.
        "workbench.startupEditor": "none",
        "workbench.tips.enabled": false,
        "workbench.welcomePage.walkthroughs.openOnInstall": false,
        // Deterministic chrome for screenshots.
        "window.titleBarStyle": "custom",
        "window.menuBarVisibility": "hidden",
        "workbench.statusBar.visible": true,
        "update.mode": "none",
        "telemetry.telemetryLevel": "off",
        "extensions.autoUpdate": false,
        "extensions.autoCheckUpdates": false,
        "git.enabled": false,
        // A fresh profile offers extension recommendations as toasts, which float over the
        // bottom-right of the window and land in failure screenshots. Suppressed by class rather
        // than dismissed after the fact — a notification cleared by command races the one that
        // arrives late on a slow runner.
        "extensions.ignoreRecommendations": true,
        // Experiments can change workbench UI between runs with no code change on our side, which is
        // the same reason `update.mode` and telemetry are off above.
        "workbench.enableExperiments": false
      },
      null,
      2
    ),
    "utf8"
  );
};

/**
 * Refuse to run if anything is already listening on our debug port. Attaching to a foreign process
 * would mean driving (and potentially killing) something we don't own — e.g. the user's real editor.
 * Fail loudly instead.
 */
const assertPortFree = async (): Promise<void> => {
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    if (res.ok) {
      throw new Error(
        `Port ${DEBUG_PORT} is already in use by another CDP target. Refusing to attach — ` +
          `close it (or change DEBUG_PORT) so the E2E run only ever drives its own VS Code.`
      );
    }
  } catch (err) {
    // A connection error is the expected, good case: nothing is listening.
    if (err instanceof Error && err.message.includes("already in use"))
      throw err;
  }
};

/**
 * Close the Chat view, which VS Code opens in the secondary side bar by default and which then eats
 * the right quarter of every full-window failure screenshot.
 *
 * This is the one piece of screenshot chrome that CANNOT be seeded through `settings.json`: side-bar
 * visibility lives in the profile's workbench state (`state.vscdb`), not in settings. So it has to be
 * a UI action — but an AWAITED one. Clicking and then waiting for the part to actually go away is not
 * the racy "dismiss the modal and hope" pattern; if the click misses, the wait fails loudly here
 * instead of showing up as noise in someone's screenshot later.
 */
const closeChatPanel = async (window: Page): Promise<void> => {
  const auxBar = window.locator(".part.auxiliarybar");
  if (!(await auxBar.isVisible())) return;
  // Selected by codicon class, not by accessible name: the name is localized, the icon is the
  // action's identity.
  await auxBar.locator(".codicon-auxiliarybar-close").first().click();
  await auxBar.waitFor({ state: "hidden", timeout: 5_000 });
};

/**
 * Dismiss every notification toast currently on screen.
 *
 * Most first-run noise is suppressed by settings (see `seedUserData`), but "All installed
 * extensions are temporarily disabled" is not: it is VS Code reporting the `--disable-extensions`
 * flag the harness itself passes, so there is no setting that prevents it. It floats over the
 * bottom-right and lands in every screenshot.
 *
 * Exported because the documentation captures need it immediately before the shutter — a toast can
 * arrive at any point during a long run, so clearing once at launch is not enough.
 */
export const clearNotifications = async (window: Page): Promise<void> => {
  const toasts = window.locator(".notifications-toasts .notification-toast");
  // Bounded rather than `while`: if a toast keeps reappearing, failing the capture is better than
  // spinning until the test timeout.
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await toasts.count()) === 0) return;
    // Selected by codicon class, like the chat panel above: the accessible name is localized.
    const close = toasts
      .first()
      .locator(".codicon-notifications-clear")
      .first();
    if (!(await close.isVisible().catch(() => false))) return;
    await close.click();
    await window.waitForTimeout(120);
  }
};

export const launchVSCode = async (
  settings: Record<string, unknown> = {}
): Promise<Launched> => {
  await assertPortFree();
  const executablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);
  const userDataDir = mkdtempSync(join(tmpdir(), "jisho-e2e-user-"));
  const extensionsDir = mkdtempSync(join(tmpdir(), "jisho-e2e-ext-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "jisho-e2e-ws-"));

  // CRITICAL: VS Code sets ELECTRON_RUN_AS_NODE=1 in its integrated terminal, and child processes
  // inherit it. With it set, Code.exe boots as a plain Node interpreter instead of the GUI — it then
  // rejects app flags ("bad option: --remote-debugging-port") and exits, so no CDP port ever opens.
  // Clearing it (plus VS Code's other IPC vars) makes the spawned instance a real, independent GUI.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VSCODE_PID;
  delete env.VSCODE_CWD;
  delete env.VSCODE_IPC_HOOK;
  delete env.VSCODE_IPC_HOOK_CLI;
  delete env.VSCODE_NLS_CONFIG;

  seedUserData(userDataDir, settings);

  const proc: ChildProcess = spawn(
    executablePath,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--extensionDevelopmentPath=${repoRoot}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      // The canonical first-run/noise suppression set, matching what @vscode/test-electron passes
      // for VS Code's own extension tests. Without --skip-welcome the fresh user-data-dir triggers
      // onboarding + a sign-in modal that overlays the workbench and contaminates screenshots.
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--no-cached-data",
      "--disable-workspace-trust",
      "--disable-gpu-sandbox",
      "--disable-extensions", // load only OUR extension via the dev path
      "--no-sandbox",
      workspaceDir
    ],
    {
      stdio: "ignore",
      env,
      // On POSIX this puts the child in its own process group so killTree can signal the whole
      // group (-pid) without touching anything else. No-op semantics we rely on for Windows, where
      // killTree uses taskkill /T instead.
      detached: process.platform !== "win32"
    }
  );

  const browser = await connectWithRetry();

  // Find the workbench window among the CDP contexts/pages.
  //
  // This must tolerate a COLD START: VS Code's window shows up as a CDP page almost immediately —
  // but as an empty shell — and `.monaco-workbench` only exists once the renderer has booted (which
  // `--no-cached-data` makes slower). So we re-enumerate pages every poll (windows can appear late)
  // and probe with a short-timeout waitForSelector rather than a one-shot `$()`, which would race
  // the boot and report "not found" against a window that was merely still loading.
  const findWorkbench = async (): Promise<Page> => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          try {
            await page.waitForSelector(".monaco-workbench", { timeout: 2_000 });
            return page;
          } catch {
            // This page isn't the workbench (or isn't ready yet) — try the next / poll again.
          }
        }
      }
      await wait(500);
    }
    throw new Error(
      "VS Code workbench window not found over CDP within 90s.\n" +
        "Most likely cause: a VS Code INSTALLER UPDATE is in progress on this machine. The spawned " +
        "instance then blocks on Inno Setup's `vscode-updating` mutex ('checkInnoSetupMutex: " +
        "vscode-updating is held') and never opens a window, so CDP reports zero targets.\n" +
        "This is transient — let the update finish and re-run. NOTE: this is a DIFFERENT message " +
        "from the harmless 'mutex already exists' noise that appears on healthy runs; that one is " +
        "safe to ignore, this one is fatal.\n" +
        "Other causes to rule out: leaked VS Code children from a previous run holding the install, " +
        "or an external indexer (e.g. GitKraken) holding a handle on .vscode-test/."
    );
  };
  const window = await findWorkbench();
  await closeChatPanel(window);

  return {
    browser,
    window,
    userDataDir,
    workspaceDir,
    setTheme: async (kind: ThemeKind): Promise<void> => {
      const { name, workbenchClass } = THEMES[kind];
      seedUserData(userDataDir, { ...settings, "workbench.colorTheme": name });
      await window
        .locator(`.monaco-workbench.${workbenchClass}`)
        .waitFor({ timeout: 15_000 });
    },
    close: async (): Promise<void> => {
      // Cleanup is PID-scoped, deliberately. NEVER call browser.close() over a CDP *attach* — it can
      // shut the target down, and an earlier version of this file closed the developer's real VS
      // Code windows that way. We only ever kill the tree rooted at the process WE spawned, so
      // nothing here can act on a target we don't own.
      //
      // It must be a TREE kill: VS Code spawns a tree (main + renderers + extension host), and a
      // plain proc.kill() only signals the launcher — survivors keep holding the install/profile,
      // which poisons later launches (they load workbench.html but never render the workbench).
      if (proc.pid !== undefined) killTree(proc.pid);
      await Promise.resolve();
    }
  };
};
