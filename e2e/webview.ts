/**
 * Helpers to open the Jisho sidebar and reach the React app inside VS Code's nested webview iframes.
 *
 * VS Code wraps a webview view in TWO iframes: an outer `iframe.webview` (the webview host frame)
 * whose src is a `vscode-webview://…` URL, and an inner iframe (`#active-frame`) that holds the
 * extension's actual HTML. So our React root lives two frame levels deep from the workbench page.
 */
import { expect, type FrameLocator, type Page } from "@playwright/test";

/** Click the Jisho activity-bar icon to reveal its sidebar view. */
export const openJishoSidebar = async (window: Page): Promise<void> => {
  // The activity-bar item carries an aria-label derived from the container title ("Jisho").
  const icon = window.locator(
    '.activitybar [aria-label*="Jisho" i], .activitybar [aria-label*="Dictionary" i]'
  );
  await icon.first().click();
};

/**
 * The frame containing our React app. Drills through the outer webview iframe into the inner
 * active-frame. Waits until our app's root has mounted (the search input exists).
 */
export const jishoFrame = async (window: Page): Promise<FrameLocator> => {
  const outer = window.locator("iframe.webview.ready, iframe.webview").first();
  await expect(outer).toBeVisible({ timeout: 30_000 });
  const inner = outer.contentFrame().locator("iframe#active-frame");
  const frame = inner.contentFrame();
  // Our app mounts a search field; wait for it so callers get a live frame.
  await expect(frame.getByRole("searchbox")).toBeVisible({ timeout: 30_000 });
  return frame;
};
