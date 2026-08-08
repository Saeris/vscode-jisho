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
 * What a scenario hands back: either an element to shoot, or a page region.
 *
 * A region rather than only a locator, because a tight crop often spans several elements — a
 * heading plus the table under it — and no single element bounds it.
 */
export type Target =
  | Locator
  | {
      page: Page;
      clip: { x: number; y: number; width: number; height: number };
    };

const isRegion = (
  t: Target
): t is {
  page: Page;
  clip: { x: number; y: number; width: number; height: number };
} => "clip" in t;

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
  // Again, AFTER the settle wait. Clearing only before it leaves a window in which a toast can
  // arrive and still be on screen at the shutter — which is exactly how "All installed extensions
  // are temporarily disabled" landed across the bottom of an overview capture.
  await clearNotifications(window);
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
 * The side-bar width every capture is taken at, set once by the suite.
 *
 * Module state rather than a per-capture option because it must hold for ALL of them: the panel is
 * container-queried, so a pass at a different width lays out differently, and a light/dark pair that
 * disagrees about more than colour is a broken pair. One setting cannot be forgotten at a call site.
 */
let docSidebarWidth: number | undefined;

export const useSidebarWidth = (width: number): void => {
  docSidebarWidth = width;
};

/**
 * Capture a target, once per theme, via the callback that puts the panel in the right state.
 *
 * `prepare` runs again for each theme rather than once, because switching the theme rewrites
 * settings.json and the webview reloads — anything the previous pass navigated to is gone.
 */
export const captureBothThemes = async (
  vscode: Launched,
  name: string,
  prepare: (theme: DocTheme) => Promise<Target>,
  { keepPointer = false }: CaptureOptions = {}
): Promise<void> => {
  mkdirSync(IMAGE_DIR, { recursive: true });
  for (const theme of THEMES) {
    await vscode.setTheme(theme);
    // Re-assert the width per theme: a theme change re-renders the workbench, and the two passes
    // laying out at different widths is exactly how the light and dark radical-picker captures
    // ended up scrolled to different positions.
    if (docSidebarWidth !== undefined)
      await widenSidebar(vscode.window, docSidebarWidth);
    const target = await prepare(theme);
    await settle(vscode.window, !keepPointer);
    const path = join(IMAGE_DIR, `${name}-${theme}.png`);
    if (isRegion(target))
      await target.page.screenshot({ path, clip: target.clip });
    else await target.screenshot({ path });
  }
};

/** The Jisho sidebar, which is the subject of most captures. */
export const sidebar = (window: Page): Locator =>
  window.locator(".part.sidebar");

/**
 * Widen the side bar past the panel's own narrow-layout breakpoint.
 *
 * The panel is CONTAINER-queried, so its layout is a function of this width, and at VS Code's
 * default 300px the conjugation table renders its stacked form — form name on one line, the two
 * cells under it. That is a real layout (`@container (max-width: 379px)` in WordDetail.module.css)
 * and the right one in a narrow sidebar, but the three-column table is the richer view and the one
 * worth documenting.
 *
 * Dragged, because side-bar width lives in the profile's workbench state rather than settings —
 * the same reason `closeChatPanel` is a UI action. The drag is AWAITED against the measured width
 * so a missed sash fails here rather than silently producing stacked-layout screenshots.
 */
export const widenSidebar = async (
  window: Page,
  width: number
): Promise<void> => {
  const bar = window.locator(".part.sidebar");
  const box = await bar.boundingBox();
  if (!box) throw new Error("the side bar has no box");
  if (Math.abs(box.width - width) < 2) return;
  // The sash sits on the side bar's trailing edge. Grab it a little inside the edge: exactly on the
  // boundary the hit-test can land on the editor instead.
  await window.mouse.move(box.x + box.width, box.y + box.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + width, box.y + box.height / 2, { steps: 10 });
  await window.mouse.up();
  await expect
    .poll(async () => Math.round((await bar.boundingBox())?.width ?? 0), {
      timeout: 5_000
    })
    .toBeGreaterThanOrEqual(width - 4);
};

/**
 * The editor area plus the sidebar — for scenarios where the POINT is the two together, such as
 * hovering a word in a file while the panel shows the same entry.
 *
 * Shot WHOLE, deliberately. The window lands at 1440x900 (16:10), not the 1440x810 the suite asks
 * for, and that is not fixable from here: Electron does not expose CDP's `Browser.setWindowBounds`
 * over an attached session, and VS Code restores its own persisted geometry over Chromium's
 * `--window-size` switch. Cropping to 16:9 would mean cutting 90px off the bottom, which takes the
 * status bar with it and makes the app look truncated. 16:10 is a standard embed ratio, so the
 * honest framing is the better one.
 */
export const workbenchRegion = (window: Page): Locator =>
  window.locator(".monaco-workbench");

/**
 * A tight crop spanning one or more elements, with breathing room.
 *
 * tldraw's manual crops to the UI being described rather than to a whole window, so the reader's eye
 * lands on the subject without hunting. Takes a LIST because a feature often spans siblings — a
 * section heading and the table beneath it — that no single element bounds.
 *
 * Returns a region rather than a locator: the padding has to come from the page, since an element
 * cannot be told to photograph more than itself.
 */
export const cropAround = async (
  window: Page,
  elements: Locator[],
  padding = 10
): Promise<Target> => {
  const boxes = await Promise.all(elements.map(async (e) => e.boundingBox()));
  const present = boxes.filter((b) => b !== null);
  if (present.length === 0) {
    throw new Error("cannot crop: none of the elements has a box");
  }
  const left = Math.min(...present.map((b) => b.x));
  const top = Math.min(...present.map((b) => b.y));
  const right = Math.max(...present.map((b) => b.x + b.width));
  const bottom = Math.max(...present.map((b) => b.y + b.height));
  const viewport = window.viewportSize() ?? { width: 1440, height: 900 };
  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  return {
    page: window,
    clip: {
      x,
      y,
      width: Math.min(viewport.width - x, right - left + padding * 2),
      height: Math.min(viewport.height - y, bottom - top + padding * 2)
    }
  };
};

/**
 * A vertical SLICE of the side bar: the panel's full width, cut to the rows you name.
 *
 * The difference between this and `cropAround` is what makes a crop readable. Cropping tight to the
 * subject's own boxes gave a 94px-wide sliver of the headword — the right region, and useless as a
 * picture, with the pitch contour clipped and the tag pills cut mid-word. Taking the width from the
 * PANEL keeps the subject in its column, with the layout's own margins around it, so the reader can
 * see what part of the page they are looking at.
 *
 * Reach for this whenever the subject is a band of a panel; keep `cropAround` for things that are
 * genuinely their own object, like a popup menu.
 */
export const sliceOfPanel = async (
  window: Page,
  elements: Locator[],
  padding = 12
): Promise<Target> => {
  const panel = await sidebar(window).boundingBox();
  if (!panel) throw new Error("the side bar has no box");
  const region = await cropAround(window, elements, padding);
  if (!isRegion(region)) throw new Error("cropAround did not return a region");
  return {
    page: window,
    clip: { ...region.clip, x: panel.x, width: panel.width }
  };
};

/**
 * Scroll an element to the TOP of the panel's scroll container.
 *
 * `scrollIntoViewIfNeeded` is not enough: it stops as soon as the element is technically visible, so
 * a heading at the very bottom edge counts as "in view" and the section under it stays off-screen —
 * which is exactly how the conjugation capture ended up showing its heading and nothing else.
 * Driving `scrollTop` puts the subject at the top, with the rest of the section below it.
 */
export const scrollToTop = async (element: Locator): Promise<void> => {
  await element.evaluate((el) => {
    // Find the nearest ancestor that actually SCROLLS, rather than matching class names. The
    // name-based version silently missed the radical picker (its scroller is `.picker`) and fell
    // through to `scrollIntoView`, which is why the light and dark passes settled at different
    // offsets. Computed overflow is the property that matters, so test for it directly.
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const { overflowY } = getComputedStyle(scroller);
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        scroller.scrollHeight > scroller.clientHeight
      )
        break;
      scroller = scroller.parentElement;
    }
    if (!scroller) {
      el.scrollIntoView({ block: "start" });
      return;
    }
    scroller.scrollTop +=
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });
  await expect(element).toBeVisible();
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
