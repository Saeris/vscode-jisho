/**
 * Screenshot capture for the README's user manual.
 *
 * Every image in the README is produced here rather than taken by hand, which buys two things: the
 * images are reproducible, and each scenario ASSERTS the flow before capturing it — so a UI change
 * that breaks a documented flow fails this run instead of quietly producing a picture of a broken
 * state. That is what makes this script double as a drift alarm.
 *
 * Run it with `vp run docs:shots`. It is excluded from the default E2E run; see the
 * `regenerating-screenshots` skill for when to re-run it.
 */
import {
  expect,
  type FrameLocator,
  type Locator,
  type Page
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { clearNotifications, type Launched } from "../launch";

/** Where the committed PNGs land. Repo-relative, because that is how the Marketplace resolves them. */
export const IMAGE_DIR = join(process.cwd(), "docs", "images");

/**
 * Both themes, captured from ONE launch.
 *
 * Light is not an arbitrary default: it is the `<img>` fallback in the README's `<picture>` blocks,
 * because the Marketplace ignores `prefers-color-scheme` entirely and renders that element
 * (microsoft/vsmarketplace#281). A dark screenshot on the Marketplace's light page reads as a
 * rendering fault rather than a choice.
 */
export const THEMES = ["light", "dark"] as const;
export type DocTheme = (typeof THEMES)[number];

/**
 * Let the panel settle before the shutter.
 *
 * Not a blanket sleep standing in for a missing assertion — scenarios assert their own state first.
 * This covers what an assertion cannot see: a webview repaint that lands a frame after the element
 * it belongs to becomes queryable, which otherwise captures mid-transition.
 */
const settle = async (window: Page, movePointer: boolean): Promise<void> => {
  // Toasts float over the bottom-right and land in the shot. "All installed extensions are
  // temporarily disabled" is VS Code reporting the harness's own `--disable-extensions` flag, so no
  // setting suppresses it — it has to be dismissed, and immediately before the shutter, because one
  // can arrive at any point during a long run.
  await clearNotifications(window);
  if (movePointer) {
    // Park the pointer in the empty editor area. Leaving it over the activity bar leaves VS Code's
    // own "Jisho" tooltip floating across the panel, which lands in the shot.
    await window.mouse.move(1200, 700);
  }
  await window.waitForTimeout(350);
};

interface CaptureOptions {
  /**
   * Leave the pointer where the scenario put it.
   *
   * For a hover capture the pointer IS the subject: moving it dismisses the card, which then
   * detaches and the screenshot fails on a stale element. Everything else wants the pointer parked
   * so no stray tooltip drifts into frame.
   */
  keepPointer?: boolean;
}

/**
 * Capture a region, once per theme, via the callback that puts the panel in the right state.
 *
 * `prepare` runs again for each theme rather than once, because switching the theme rewrites
 * settings.json and the webview reloads — anything the previous pass navigated to is gone.
 */
export const captureBothThemes = async (
  vscode: Launched,
  name: string,
  prepare: (theme: DocTheme) => Promise<Locator>,
  { keepPointer = false }: CaptureOptions = {}
): Promise<void> => {
  mkdirSync(IMAGE_DIR, { recursive: true });
  for (const theme of THEMES) {
    await vscode.setTheme(theme);
    const target = await prepare(theme);
    await settle(vscode.window, !keepPointer);
    await target.screenshot({ path: join(IMAGE_DIR, `${name}-${theme}.png`) });
  }
};

/** The Jisho sidebar, which is the subject of most captures. */
export const sidebar = (window: Page): Locator =>
  window.locator(".part.sidebar");

/**
 * The editor area plus the sidebar — for scenarios where the POINT is the two together, such as
 * hovering a word in a file and reading its definition.
 */
export const workbenchRegion = (window: Page): Locator =>
  window.locator(".monaco-workbench");

/**
 * A tight crop around one element, with breathing room.
 *
 * tldraw's manual crops to the UI being described rather than to a whole window, so the reader's eye
 * lands on the subject without hunting. Returns a clip rather than a locator because the padding has
 * to come from the page, not from an element that does not have it.
 */
export const clipAround = async (
  window: Page,
  element: Locator,
  padding = 12
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await element.boundingBox();
  if (!box) throw new Error("cannot crop around an element with no box");
  const viewport = window.viewportSize() ?? { width: 1440, height: 900 };
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  return {
    x,
    y,
    width: Math.min(viewport.width - x, box.width + padding * 2),
    height: Math.min(viewport.height - y, box.height + padding * 2)
  };
};

/**
 * Assert the docs run is against the FULL dictionary before anything is captured.
 *
 * The common build is a ~22,000-word subset, and the difference is visible in the screenshots rather
 * than hidden behind them: measured, `#computing` holds 220 words there against 10,712 in the full
 * build, and slang like きもい does not exist at all. A browse list is counts-in-a-list, so a
 * common-build capture would misrepresent the product to every reader of the listing.
 *
 * Fails loudly instead of quietly producing wrong images.
 */
export const assertFullDictionary = async (
  frame: FrameLocator
): Promise<void> => {
  // The About view renders the DB's own `variant` metadata in a table, so this reads the value the
  // extension actually loaded rather than inferring it from a word that happens to be present.
  const variantRow = frame
    .locator("tr")
    .filter({ hasText: "Variant" })
    .locator("td")
    .last();
  await expect(
    variantRow,
    "docs screenshots need the FULL dictionary: run `vp run build:data:full`, " +
      "which writes assets/jisho.db as variant=full"
  ).toHaveText("full", { timeout: 30_000 });
};
