/**
 * Helpers to open the Jisho sidebar and reach the React app inside VS Code's nested webview iframes.
 *
 * VS Code wraps a webview view in TWO iframes: an outer `iframe.webview` (the webview host frame)
 * whose src is a `vscode-webview://…` URL, and an inner iframe (`#active-frame`) that holds the
 * extension's actual HTML. So our React root lives two frame levels deep from the workbench page.
 */
import { expect, type FrameLocator, type Page } from "@playwright/test";

/**
 * Screenshot just the Jisho sidebar, not the whole workbench.
 *
 * For visual iteration this is what we actually care about — a full-window shot is mostly VS Code
 * chrome (and whatever panels happen to be open), which both buries our UI and makes any future
 * visual-regression baseline brittle to unrelated editor changes.
 */
export const screenshotSidebar = async (
  window: Page,
  path: string
): Promise<void> => {
  // Park the cursor off in the empty editor area first: clicking the activity-bar icon leaves the
  // pointer hovering it, and VS Code's "Jisho" tooltip then floats over the sidebar and lands in
  // the shot. Moving away dismisses it.
  await window.mouse.move(900, 500);
  await window.waitForTimeout(300); // let the tooltip fade out
  await window.locator(".part.sidebar").screenshot({ path });
};

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
  // Wait for the app ROOT, not a view-specific element. The search view is kept mounted-but-hidden
  // by <Activity> when a detail view is pushed, so waiting on the searchbox to be *visible* would
  // hang for any caller that isn't currently on the search view.
  await expect(frame.locator("#root")).toBeAttached({ timeout: 30_000 });
  return frame;
};
