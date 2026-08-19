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
 * Hover a Japanese word in the editor and wait for its dictionary hover to appear.
 *
 * The editor hover is the flakiest thing to drive, and both prior approaches were unreliable — one
 * test used Playwright's `.hover()` (moves to an element centre and fires synthetic events), the
 * other an ad-hoc mouse dance. The failures look like "only passes when I hover manually," because:
 *
 *  1. VS Code's hover is triggered by a real `mousemove` and a DWELL timer, not by a DOM mouseover.
 *     A move that lands and immediately asserts can beat the timer. So we move AWAY, then onto the
 *     target — a genuine positional transition VS Code reacts to — and give it a beat.
 *  2. The hovered word is computed from the PIXEL under the cursor. A `.view-line` spans the whole
 *     editor width and Monaco chunks glyphs into arbitrary spans, so centre-of-element aims wrong.
 *     We measure the first text span and index into it by character.
 *  3. It is still occasionally missed (GC pause, first-hover warmup). So we RETRY the move a few
 *     times rather than trust a single attempt — the one thing a manual tester does naturally.
 *
 * `charIndex` is 0-based into the run's characters; `charCount` is the run length (both needed to
 * split the measured text box). Returns the populated hover locator, filtered by `contains`.
 */
export const hoverEditorWord = async (
  window: Page,
  lineText: string,
  charIndex: number,
  charCount: number,
  contains: string
): Promise<Locator> => {
  const line = window.locator(".view-line", { hasText: lineText }).first();
  await line.waitFor();
  const span = line.locator("span").first();
  const box = await span.boundingBox();
  if (!box) throw new Error(`could not measure the text of "${lineText}"`);
  const charWidth = box.width / charCount;
  const x = box.x + charWidth * (charIndex + 0.5);
  const y = box.y + box.height / 2;

  const hover = window
    .locator(".monaco-hover-content")
    .filter({ hasText: contains });

  // Up to 5 attempts: each is a real away→onto move plus a dwell. A single move is what made this
  // "only works when I hover it myself" — a person naturally jiggles the mouse until it shows.
  for (let attempt = 0; attempt < 5; attempt++) {
    await window.mouse.move(x, box.y + box.height * 4);
    await window.mouse.move(x, y);
    await window.mouse.move(x + 1, y); // nudge, so a repeat attempt still counts as movement
    try {
      await expect(hover).toBeVisible({ timeout: attempt === 0 ? 8000 : 3000 });
      return hover;
    } catch {
      if (attempt === 4)
        throw new Error(`hover never appeared for "${contains}"`);
    }
  }
  return hover;
};

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
/**
 * Type a query into the search box, replacing whatever is there.
 *
 * `.fill()` does NOT work on it: the box is a `TokenField` (#27), a contenteditable rather than an
 * `<input>`, so Playwright reports "Not an input element". Select-all then type is the equivalent
 * that works on both, and it exercises the same path a user does — which matters here, because
 * tokenising a `#tag` happens as text is EDITED, and a value set wholesale would skip it.
 */
export const fillSearch = async (
  frame: FrameLocator,
  query: string
): Promise<void> => {
  const box = frame.getByRole("searchbox");
  await box.click();
  // Select-all then overwrite, so this REPLACES rather than appends — the semantics `.fill()` had.
  await box.press("ControlOrMeta+a");
  if (query === "") {
    await box.press("Delete");
    return;
  }
  await box.pressSequentially(query);
};

/** The search box's current text — `textContent`, since it is not an input with a `value`. */
export const searchText = async (frame: FrameLocator): Promise<string> =>
  (await frame.getByRole("searchbox").textContent())?.trim() ?? "";

/**
 * Put the panel back on an empty search view, from wherever a previous spec left it.
 *
 * Two things can be in the way, and both must be undone: a pushed DETAIL view (popped with Home or
 * Back, per the comment above) and a selected TAB other than Search (#55). One VS Code is shared by
 * the whole run, so anything left behind here surfaces as an unrelated spec failing on a control it
 * expected to exist.
 */
export const returnToSearch = async (frame: FrameLocator): Promise<void> => {
  const searchbox = frame.getByRole("searchbox");
  const home = frame.getByRole("button", { name: "Back to search" });
  const back = frame.getByRole("button", { name: "Back", exact: true });
  // The drill-down views replaced their `← Back` bar with a breadcrumb trail (#55), so a word list
  // has neither of the two buttons above. Its way out is the trail's first crumb.
  //
  // `[role="link"]`, not `a`: React Aria's Link renders a `<span role="link">` when it has `onPress`
  // and no `href`, so an element selector matches NOTHING here (measured).
  //
  // `:visible` is load-bearing too. The tab panels are force-mounted, so the Vocab tab's own trail
  // is STILL IN THE DOM behind a pushed word list — measured: two `aria-current="page"` crumbs at
  // once, "JLPT level" (hidden tab) and "N5" (the pushed view) — and an unscoped match clicks the
  // hidden one, which does nothing. Matching by position rather than label is deliberate: the label
  // varies ("Vocab"/"Kanji" when drilled from a tab, ⌂ on graph arrival), and enumerating them would
  // break the next time one is added.
  const crumbHome = frame.locator('ol li [role="link"]:visible').first();

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
    else if (await visible(crumbHome)) await crumbHome.click();
    else if (await visible(back)) await back.click();
    else break;
  }

  // Popping the stack is not enough once the root has SECTIONS (#55 step 1). The search box lives on
  // the Search tab, so a spec that left the panel on Vocab, Kanji or Kana lands here at depth 1 with
  // nothing to pop and no search box — and because one VS Code is shared across the whole run, every
  // later test using this fixture then failed on a missing searchbox rather than on its own subject.
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  if (!(await visible(searchbox)) && (await visible(tabs))) {
    await tabs.getByRole("tab", { name: "Search" }).click();
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

/**
 * Put the panel on the Vocab tab's group list — the entry point to category browsing.
 *
 * Replaces the "Browse words by category" button that #54 put on the empty search view and #55 step
 * 1 removed: browsing is a top-level SECTION now, not somewhere you navigate to from search. Seven
 * captures opened the tree through that button and broke the moment it went.
 *
 * Two things have to be undone first, and the order matters:
 *
 *  1. A pushed view (a word list from an earlier spec) HIDES the tab bar, so the tab cannot be
 *     clicked until the stack is popped. `returnToSearch` already knows every way out.
 *  2. The tab keeps its own drill level — component state that survives switching away, which is
 *     the point of force-mounting the panels — so selecting Vocab can land inside a group. Its trail
 *     root is also labelled "Vocab", so this has to run AFTER the pop or it clicks the pushed view's
 *     crumb instead and merely pops to the tab, leaving the drill level untouched.
 */
export const openBrowseTab = async (frame: FrameLocator): Promise<void> => {
  await returnToSearch(frame);
  await frame
    .getByRole("tablist", { name: "Sections" })
    .getByRole("tab", { name: "Vocab" })
    .click();

  // Looping on the POSTCONDITION rather than trusting one conditional click: what a crumb click
  // does depends on which view is showing, and this has to end at the group list either way.
  const heading = frame.getByRole("heading", { name: "Browse" });
  const upToRoot = frame
    .locator('ol li [role="link"]:visible')
    .filter({ hasText: "Vocab" });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await heading.isVisible().catch(() => false)) break;
    if (!(await upToRoot.isVisible().catch(() => false))) break;
    await upToRoot.click({ force: true });
  }
  await expect(heading).toBeVisible();
};

/**
 * The breadcrumb crumb naming the page you are on.
 *
 * The drill-down views (Vocab, Kanji, a word list) no longer render an `<h1>` — the trail's last
 * crumb IS the heading, which is what let the header collapse to one row (#55). Specs that waited on
 * a heading wait on this instead; it carries `aria-current="page"`, so it is addressable without
 * depending on the trail's depth.
 */
export const currentCrumb = (frame: FrameLocator, name: string): Locator =>
  // `:visible` because the tab panels are force-mounted: a pushed word list leaves the Vocab tab's
  // own trail in the DOM behind it, so two `aria-current` crumbs can exist at once and an unscoped
  // match trips Playwright's strict mode (measured — "JLPT level" and "N5" together).
  frame.locator('[aria-current="page"]:visible').filter({ hasText: name });

/**
 * Search a literal and open its first KANJI result.
 *
 * Targets the Kanji section's listbox specifically. Both sections render `role=option`, and the kanji
 * row's accessible name is the whole row ("食eat, foodショク、ジキ…") rather than the literal, so it is
 * matched by the section's aria-label instead.
 */
export const openKanjiResult = async (
  frame: FrameLocator,
  literal: string
): Promise<void> => {
  await fillSearch(frame, literal);
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
};

/**
 * Run a Jisho command through the palette. Focus must already be outside the webview.
 *
 * Opened with F1 and, if that does not take, the Ctrl/Cmd+Shift+P chord. Both are stock bindings
 * and each has been seen to work where the other did not — F1 across the smoke suite, the chord in
 * `settings.e2e.ts`, whose seeded profile leaves F1 doing nothing. Rather than pick one and have
 * the suites disagree, this tries both and reports what it saw.
 *
 * Waiting for the matching ROW before Enter is what stops the press racing the filter and running
 * whichever command happened to be highlighted first.
 */
export const runCommand = async (win: Page, name: string): Promise<void> => {
  const palette = win.locator(".quick-input-widget");
  await win.keyboard.press("F1");
  try {
    await palette.waitFor({ timeout: 2000 });
  } catch {
    await win.keyboard.press("ControlOrMeta+Shift+P");
    await palette.waitFor({ timeout: 5000 });
  }
  await win.keyboard.type(`Jisho: ${name}`);
  await win
    .locator(".quick-input-list .monaco-list-row", { hasText: name })
    .first()
    .waitFor();
  await win.keyboard.press("Enter");
  // The palette closing is the signal the command actually RAN. Without it the assertions that
  // follow can poll against a UI that has not been asked to change yet.
  await palette.waitFor({ state: "hidden" });
};
