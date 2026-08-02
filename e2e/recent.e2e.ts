import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import { jishoFrame, openJishoSidebar } from "./webview";

/** Recent-search history (#17): recorded on OPEN, rendered on the empty view, re-run on tap. */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;

test.beforeAll(async () => {
  vscode = await launchVSCode({});
  await openJishoSidebar(vscode.window);
});
test.afterAll(async () => {
  await vscode?.close();
});

test("records a lookup and re-runs it from the empty view", async () => {
  const win = vscode!.window;
  const frame = await jishoFrame(win);

  // Empty view before any history: the plain hint.
  await expect(frame.getByText("Type to search the dictionary.")).toBeVisible();

  // Search, then OPEN a result — the commit signal.
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame.getByRole("button", { name: /back/i }).click();

  // Clearing the box reveals the history rather than the hint.
  await frame.getByRole("searchbox").fill("");
  const recent = frame.getByRole("listbox", { name: "Recent searches" });
  await expect(recent).toBeVisible();
  await expect(recent.getByRole("option").first()).toContainText("食べる");

  // Capture the history itself, not the state after re-running it.
  await win.screenshot({ path: "test-results/shots/21-recent-searches.png" });

  // Tapping re-runs the query.
  await recent.getByRole("option").first().click();
  await expect(frame.getByRole("searchbox")).toHaveValue("食べる");
});
