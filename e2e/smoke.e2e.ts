import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import { jishoFrame, openJishoSidebar } from "./webview";

// The foundational end-to-end path: real VS Code launches, our extension activates, the sidebar
// webview renders, and a search returns real DB-backed results. If this passes, the harness works
// and every richer E2E builds on it.
test.describe.configure({ mode: "serial" });

// Possibly undefined: if beforeAll throws, afterAll still runs and must not itself explode.
let vscode: Launched | undefined;

/** The launched instance, asserted present — keeps test bodies free of `!` noise. */
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode();
});

test.afterAll(async () => {
  await vscode?.close();
});

test("opens the Jisho sidebar and renders the search UI", async () => {
  await openJishoSidebar(app().window);
  const frame = await jishoFrame(app().window);
  // jishoFrame only waits for the app root (the search view can be hidden behind a detail view),
  // so assert the search UI explicitly here.
  await expect(frame.getByRole("searchbox")).toBeVisible();
  // Capture the whole workbench: proves no first-run/sign-in modal is overlaying the UI, and is the
  // entry point for the visual-iteration loop (look at real pixels, refine, re-shoot).
  await app().window.screenshot({ path: "test-results/shots/01-sidebar.png" });
});

test("searching a word returns real dictionary results", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("食べる");
  // Results are DB-backed; 食べる must appear as an option in the list.
  await expect(frame.getByText("食べる").first()).toBeVisible();
  await expect(frame.getByText("to eat").first()).toBeVisible();
});

test("tapping a result opens its word detail", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();

  // NOTE: the search view stays MOUNTED (inside <Activity>) when a detail view is pushed, so a bare
  // getByText() also matches the now-hidden search results. Assert on visible elements only.
  // The Back control is the detail view's unambiguous marker.
  await expect(frame.getByRole("button", { name: /back/i })).toBeVisible();
  // The detail shows the reading and a resolved part-of-speech tag ("Ichidan verb").
  await expect(
    frame.getByText("たべる").locator("visible=true").first()
  ).toBeVisible();
  await expect(
    frame
      .getByText(/ichidan/i)
      .locator("visible=true")
      .first()
  ).toBeVisible();
});

test("editor command: Look Up Selection drives the sidebar search", async () => {
  const win = app().window;
  // A real editor with Japanese text, selected. Focus sits in the editor, so the palette works
  // (inside the webview, F1 goes to the extension's own search box instead).
  await win.keyboard.press("Control+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  await win.keyboard.type("食べました");
  await win.keyboard.press("Control+a");

  await win.keyboard.press("F1");
  await win.locator(".quick-input-widget").waitFor();
  await win.keyboard.type("Jisho: Look Up Selection");
  await win
    .locator(".quick-input-list .monaco-list-row", {
      hasText: "Look Up Selection"
    })
    .first()
    .waitFor();
  await win.keyboard.press("Enter");

  // The command reveals the sidebar and pushes the query through: the search box carries the
  // selection and deinflected results (食べました → 食べる) arrive from the real DB.
  const frame = await jishoFrame(win);
  await expect(frame.getByRole("searchbox")).toHaveValue("食べました");
  await expect(frame.getByText("to eat").first()).toBeVisible();
});

test("hovering Japanese text shows a dictionary hover", async () => {
  // Self-contained: its own untitled editor, so the test runs standalone (and under --grep).
  const win = app().window;
  // The hover provider only exists once the extension ACTIVATES, and activation rides on the
  // sidebar view — in a standalone run nothing else has opened it (found via a failure screenshot
  // showing the Explorer and a dead hover).
  await openJishoSidebar(win);
  // Focus the editor area first — keystrokes die if focus sits in a webview or is unset at
  // launch (the F1-in-webview lesson again).
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("Control+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  // The hardest case in one line: mirrordown ruby markup AND a complex conjugation. The braces
  // must not split the run, the cursor lands on "{" and maps into the base, the auxiliaries
  // (たくなかった) group onto the verb, and the lemma 食べる resolves the entry.
  await win.keyboard.type("{食|た}べたくなかった");
  const word = win.locator(".view-line", { hasText: "べたくなかった" }).first();
  await word.waitFor();
  await word.locator("span span").first().hover();
  // Each editor owns an (empty) hover container; filter to the one that actually populated.
  const hover = win
    .locator(".monaco-hover-content")
    .filter({ hasText: "to eat" });
  // Generous timeout: a standalone run pays tokenizer + dictionary warm-up on this first hover.
  await expect(hover).toBeVisible({ timeout: 20_000 });
  await expect(hover).toContainText("食べる");
  // The conjugation chain of the detected form, labelled (user request: contextual meaning).
  await expect(hover).toContainText("want to");
  await expect(hover).toContainText("past");
  await expect(hover).toContainText("Open in Jisho");
  // Reference shot for the hover-design iteration (BACKLOG #33: user wants to refine it visually).
  await app().window.screenshot({ path: "test-results/shots/02-hover.png" });
});
