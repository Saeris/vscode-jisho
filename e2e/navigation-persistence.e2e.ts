import { expect, test, type Page } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import { jishoFrame, openJishoSidebar, returnToSearch } from "./webview";

/**
 * Does navigation survive the sidebar being hidden?
 *
 * VS Code deallocates a WebviewView's underlying DOCUMENT when the user collapses the view or
 * switches to another activity-bar container — the view object survives, its document does not, and
 * it is recreated on the way back. `retainContextWhenHidden` is NOT available for WebviewView (it
 * lives on WebviewPanelOptions; the typings' own WebviewViewResolveContext doc wrongly points at
 * WebviewOptions, which is why the advice online contradicts itself). So the only way state survives
 * is `acquireVsCodeApi().setState()`, restored from the `context` argument of resolveWebviewView.
 *
 * This is easy to miss in development because the F5 loop rarely collapses the sidebar.
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;

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

/** Switch the sidebar to Explorer and back, which is what deallocates the webview document. */
const switchAwayAndBack = async (window: Page): Promise<void> => {
  await window
    .locator('.activitybar [aria-label*="Explorer" i]')
    .first()
    .click();
  // The Jisho webview must actually go away, or we would be asserting on a view that never reloaded.
  await expect(window.locator("iframe.webview")).toBeHidden({
    timeout: 15_000
  });
  await openJishoSidebar(window);
};

test("keeps the open word on the stack when the sidebar is hidden and reopened", async () => {
  await openJishoSidebar(app().window);
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);

  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  const back = frame.getByRole("button", { name: "Back", exact: true });
  await expect(back).toBeVisible();

  await switchAwayAndBack(app().window);

  // WHY this assertion: a user who taps a word, glances at their file tree, and comes back expects
  // to still be reading that word. Losing the stack drops them at an empty search box having
  // forgotten what they looked up.
  const reopened = await jishoFrame(app().window);
  await expect(
    reopened.getByRole("button", { name: "Back", exact: true })
  ).toBeVisible({ timeout: 15_000 });
});

test("keeps the search query when the sidebar is hidden and reopened", async () => {
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);
  await frame.getByRole("searchbox").fill("water");
  await expect(frame.getByRole("option").first()).toBeVisible();

  await switchAwayAndBack(app().window);

  const reopened = await jishoFrame(app().window);
  await expect(reopened.getByRole("searchbox")).toHaveValue("water", {
    timeout: 15_000
  });
});
