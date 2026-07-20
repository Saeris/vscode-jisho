/**
 * Helpers to open the Jisho sidebar and reach the React app inside VS Code's nested webview iframes.
 *
 * VS Code wraps a webview view in TWO iframes: an outer `iframe.webview` (the webview host frame)
 * whose src is a `vscode-webview://…` URL, and an inner iframe (`#active-frame`) that holds the
 * extension's actual HTML. So our React root lives two frame levels deep from the workbench page.
 */
import {
  expect,
  type FrameLocator,
  type Locator,
  type Page
} from "@playwright/test";

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

/**
 * Reveal the Jisho sidebar view, whether or not it is already showing.
 *
 * The activity-bar icon TOGGLES, so an unconditional click closes the sidebar when it is already
 * open — and every test here calls this defensively at its start so it can run standalone. That is
 * fine until one test leaves the sidebar open, at which point the next one's "open" call closes it
 * and its `iframe.webview` lookup fails with no obvious connection to the real cause. Checking
 * first makes the call mean "ensure open" rather than "toggle", which is what every caller assumes.
 */
export const openJishoSidebar = async (window: Page): Promise<void> => {
  // The activity-bar item carries an aria-label derived from the container title ("Jisho").
  const icon = window.locator(
    '.activitybar [aria-label*="Jisho" i], .activitybar [aria-label*="Dictionary" i]'
  );
  const webview = window.locator("iframe.webview").first();
  if (await webview.isVisible().catch(() => false)) return;
  await icon.first().click();
  await expect(webview).toBeVisible({ timeout: 30_000 });
};

/**
 * Put the sidebar back on the search view, from whatever view a previous test left it on.
 *
 * Tests in a file share one VS Code instance, so each inherits the last one's navigation state.
 * That makes every test's starting view an implicit dependency on execution order — and when it is
 * wrong the symptom is a 120s timeout, because a locator for a control that only exists on another
 * view simply waits forever. One such hang cost more wall-clock time than the rest of the suite.
 *
 * Both buttons have to be handled, because the app offers them conditionally: `⌂ Home` appears
 * only when drilled MORE than one level deep, since at one level it would just duplicate `← Back`
 * (see `canGoHome` in App.tsx). So Home alone strands a word-detail view, and a single Back alone
 * strands the stroke-order view (search → kanji → strokes). Pop with Home when offered, then Back
 * until the searchbox is reachable.
 *
 * Names are matched exactly rather than with a loose /back/i, which matches BOTH buttons and trips
 * Playwright's strict mode.
 */
export const returnToSearch = async (frame: FrameLocator): Promise<void> => {
  const searchbox = frame.getByRole("searchbox");
  const home = frame.getByRole("button", { name: "Back to search" });
  const back = frame.getByRole("button", { name: "Back", exact: true });

  // Short timeouts throughout: on the search view these buttons legitimately do not exist, which is
  // the common case rather than an error, and the whole point of this helper is to not sit waiting.
  const visible = async (locator: Locator): Promise<boolean> => {
    try {
      return await locator.isVisible({ timeout: 2_000 });
    } catch {
      return false;
    }
  };

  // Bounded rather than `while (true)`: if navigation ever stops responding, failing on the
  // postcondition below with a real message beats spinning until the test timeout.
  for (let depth = 0; depth < 5; depth++) {
    if (await visible(searchbox)) break;
    if (await visible(home)) await home.click();
    else if (await visible(back)) await back.click();
    else break;
  }

  // Assert the postcondition rather than trusting the clicks. If this fails the message names the
  // real problem ("never reached the search view") instead of surfacing later as a mystery timeout
  // on whatever control the test looks for next.
  await expect(searchbox).toBeVisible({ timeout: 10_000 });
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
