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
