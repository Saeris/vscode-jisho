import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures";
import {
  currentCrumb,
  fillSearch,
  openBrowseTab,
  screenshotSidebar
} from "../webview";

/**
 * Whether the optional JMnedict names database has been built (`vp run build:data:names`).
 *
 * The `#name`/`#place` result types are HIDDEN when it is absent — that is the extension behaving
 * correctly, not a failure — so a test that clicks them has to check the same thing the host does.
 * CI provisions only `build:data` (the names build is ~743k entries / ~400MB, too slow to make
 * every Release run pay for one screenshot), so without this guard that test fails there while
 * passing locally.
 */
const hasNamesDb = existsSync(join(process.cwd(), "assets", "jisho-names.db"));

/**
 * Browsing by category (#54): the tree, a group, and a word list in both orderings.
 *
 * Serial because each capture drills one level deeper than the last — the navigation stack IS the
 * subject here, not incidental setup.
 */
test.describe.configure({ mode: "serial" });

test("capture: browse tree", async ({ vscode, jisho }) => {
  // The tree is the Vocab TAB now (#55 step 1), not a view reached from the search screen — the
  // helper asserts the group list is showing, so there is nothing further to wait for here.
  await openBrowseTab(jisho);
  await screenshotSidebar(vscode.window, "test-results/shots/30-browse.png");
});

test("capture: a group's categories, with counts", async ({
  vscode,
  jisho
}) => {
  await openBrowseTab(jisho);
  await jisho.getByRole("button", { name: /Browse JLPT level/i }).click();
  await currentCrumb(jisho, "JLPT level").waitFor();
  // The counts arrive from the host, so wait for a real number rather than the empty placeholder.
  await expect(
    jisho.getByRole("button", { name: /N5, \d+ words/ })
  ).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/31-browse-group.png"
  );
});

test("capture: a word list, gojuon then by frequency", async ({
  vscode,
  jisho
}) => {
  await openBrowseTab(jisho);
  await jisho.getByRole("button", { name: /Browse JLPT level/i }).click();
  await jisho.getByRole("button", { name: /N5, \d+ words/ }).click();
  await currentCrumb(jisho, "N5").waitFor();
  // Gojūon is the DEFAULT: the list is an index, and kana order plus the rail is how a Japanese
  // dictionary is navigated. `option`, not `menuitem` — the word list is a ListBox; only the tag
  // autocomplete is a Menu.
  await expect(jisho.getByRole("option").first()).toBeVisible();
  await expect(
    jisho.getByRole("navigation", { name: /jump to kana/i })
  ).toBeVisible();
  await screenshotSidebar(vscode.window, "test-results/shots/32-word-list.png");

  // Frequency is the alternative, for reading the list as a study order. It drops the rail, which
  // would otherwise scroll to arbitrary places — the readings are in no particular sequence.
  await jisho.getByRole("button", { name: "By frequency" }).click();
  await expect(
    jisho.getByRole("navigation", { name: /jump to kana/i })
  ).toBeHidden();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/33-word-list-frequency.png"
  );
});

test("the word list's root crumb reaches the top of the tab, not one step up", async ({
  jisho
}) => {
  // WHY (reported bug): from `Vocab › Subject › Computing`, tapping "Vocab" went to
  // `Vocab › Subject`. Both upward crumbs were wired to the same stack pop, which reveals the tab
  // still drilled into its group — right for "Subject", wrong for "Vocab". Each crumb must land
  // where its label says, and only a real render settles it: the fix moved the tab's drill level
  // onto the machine so a PUSHED view can reset it, which is exactly the cross-component wiring
  // component tests cannot see.
  await openBrowseTab(jisho);
  await jisho.getByRole("button", { name: /Browse Subject/i }).click();
  await jisho.getByRole("button", { name: /Computing, \d+ words/ }).click();
  await currentCrumb(jisho, "Computing").waitFor();

  // The middle crumb goes one level up, to the group the reader drilled through.
  await jisho
    .locator('ol li [role="link"]:visible')
    .filter({ hasText: "Subject" })
    .click();
  await expect(currentCrumb(jisho, "Subject")).toBeVisible();

  // Back in, then the ROOT crumb — which must reach the group list, not "Subject" again.
  await jisho.getByRole("button", { name: /Computing, \d+ words/ }).click();
  await currentCrumb(jisho, "Computing").waitFor();
  await jisho
    .locator('ol li [role="link"]:visible')
    .filter({ hasText: "Vocab" })
    .click();
  await expect(jisho.getByRole("heading", { name: "Browse" })).toBeVisible();
  await expect(
    jisho.getByRole("button", { name: /Browse Subject/i })
  ).toBeVisible();
});

test("capture: #tag autocomplete and a tag token", async ({
  vscode,
  jisho
}) => {
  // Typing `#` is the discovery path — it offers the vocabulary to someone who does not know it.
  await jisho.getByRole("searchbox").click();
  await jisho.getByRole("searchbox").pressSequentially("#jlpt");
  await expect(jisho.getByRole("menu").first()).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/34-tag-autocomplete.png"
  );

  // WHY (user report): the menu used to be pinned to the field's exact width, so in a narrow panel
  // rows wrapped mid-word ("Goda / n / verbs") with usable space sitting unused beside the sidebar.
  // Measured rather than eyeballed: a wrapped row is roughly double height, so a single-line bound
  // catches the regression without hard-coding the theme's line height. `#go` is the reported query
  // and pulls the longest label in the set, "Yojijukugo (four-character)".
  await fillSearch(jisho, "#go");
  await jisho.getByRole("menuitem").first().waitFor();
  for (const row of await jisho.getByRole("menuitem").all()) {
    expect((await row.boundingBox())?.height ?? 99).toBeLessThan(30);
  }
  // …and the menu still has to fit on screen: React Aria has no maxWidth prop, so the CSS cap is
  // the only thing stopping a long row from overflowing. Measured against the WORKBENCH element
  // rather than `viewportSize()`, which returns null for this Electron window (a `?? 0` fallback
  // silently turned this into "must be <= 0" and failed on a menu that was fitting perfectly).
  const menu = await jisho.getByRole("menu").first().boundingBox();
  const shell = await vscode.window.locator(".monaco-workbench").boundingBox();
  expect(shell?.width ?? 0).toBeGreaterThan(0);
  expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(
    (shell?.x ?? 0) + (shell?.width ?? 0)
  );
  await fillSearch(jisho, "#jlpt");
  await expect(jisho.getByRole("menuitem", { name: /N5/ })).toBeVisible();

  // Completing one turns it into a token — atomic, and carrying the resolved classifier. The token
  // renders the classifier's LABEL ("N5"), not the raw id it was typed as, so the committed filter
  // reads the same way the browse tree names it.
  await jisho.getByRole("menuitem", { name: /N5/ }).first().click();
  await expect(jisho.getByRole("searchbox")).toContainText("N5");
  await screenshotSidebar(vscode.window, "test-results/shots/35-tag-token.png");
});

test("two tags narrow together", async ({ jisho }) => {
  // WHY (user report): tags are FILTERS. `#jlpt-n5` alone returns N5 words; adding `#verb-godan`
  // must intersect, not replace. 76 words carry both in the shipped dictionary, so the narrowed
  // list is non-empty but strictly smaller — which is what makes this a real check rather than a
  // "still shows something" one.
  await jisho.getByRole("searchbox").click();
  await jisho.getByRole("searchbox").pressSequentially("#jlpt-n5 ");
  const n5Only = await jisho.getByRole("option").count();
  expect(n5Only).toBeGreaterThan(0);

  await jisho.getByRole("searchbox").pressSequentially("#verb-godan ");
  await expect
    .poll(async () => jisho.getByRole("option").count())
    .toBeLessThan(n5Only);
  // And still non-empty: an intersection that emptied would mean the filters are not composing.
  expect(await jisho.getByRole("option").count()).toBeGreaterThan(0);
});

test("arrow keys drive the tag suggestions", async ({ jisho }) => {
  // WHY (user report, twice): typing `#` must open the list AND ↓ must move through it, with Enter
  // committing the highlighted one. The component tests passed while this was broken in the real
  // webview, so the check belongs here — in a real browser, against the real event sequence.
  const box = jisho.getByRole("searchbox");
  await box.click();
  // `#jlpt` rather than a bare `#`, so this test is about the KEYS rather than about which category
  // happens to sort first — adding the result-type group changed that once already.
  await box.pressSequentially("#jlpt");
  await expect(jisho.getByRole("menuitem").first()).toBeVisible();

  // The highlighted item, as a locator rather than a polled read: `expect.poll` re-invokes its
  // callback until the assertion passes, which against a value the NEXT keypress changes made this
  // race its own steps.
  const highlighted = jisho.locator('[role="menuitem"][data-focused]');

  // Typing a fragment pre-highlights the best match, so Enter commits it without ever touching the
  // arrows — the fast path. The arrows then move from there.
  await expect(highlighted).toContainText("N5");
  await box.press("ArrowDown");
  await expect(highlighted).toContainText("N4");
  await box.press("ArrowDown");
  await expect(highlighted).toContainText("N3");
  await box.press("ArrowUp");
  await expect(highlighted).toContainText("N4");

  // Enter commits whatever is highlighted — N4 after the ↓↓↑ above, not the first item blindly.
  await box.press("Enter");
  await expect(box).toContainText("N4");
});

test("kana rail scrolls its section to the top of the list", async ({
  vscode,
  jisho
}) => {
  // WHY (user request): a thumb index should land the section heading at the TOP of the visible
  // list, not merely somewhere on screen — `scrollIntoView` aligns to the nearest edge, which
  // leaves the heading at the bottom when scrolling downward.
  await openBrowseTab(jisho);
  await jisho.getByRole("button", { name: /Browse JLPT level/i }).click();
  await jisho.getByRole("button", { name: /N5, \d+ words/ }).click();
  await currentCrumb(jisho, "N5").waitFor();

  // Gojūon is the default, so the rail is present without switching order first.
  const rail = jisho.getByRole("navigation", { name: /jump to kana/i });
  await expect(rail).toBeVisible();
  await rail.getByRole("button", { name: "か", exact: true }).click();

  // The か heading sits within a few pixels of the list's own top edge.
  const offset = await jisho.locator('[data-row="か"]').evaluate((heading) => {
    const list = heading.closest("[class*='list']");
    if (!list) return 999;
    return Math.abs(
      heading.getBoundingClientRect().top - list.getBoundingClientRect().top
    );
  });
  expect(offset).toBeLessThan(8);
  await screenshotSidebar(vscode.window, "test-results/shots/36-kana-jump.png");
});

test("result-type tags appear, and dead combinations do not", async ({
  vscode,
  jisho
}) => {
  // WHY (#27): `#kanji` selects a KIND of result, which is a different question from the word
  // filters — a learner may want the character rather than a word containing it.
  const box = jisho.getByRole("searchbox");
  await box.click();
  // `#kanj`, not `#kanji`: a fully-typed tag tokenises itself immediately (that is what the value's
  // tokenizer does), so the menu would already be closed by the time this looked at it.
  await box.pressSequentially("#kanj");
  await expect(jisho.getByRole("menuitem", { name: /Kanji/ })).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/37-result-tags.png"
  );

  // Commit it by CLICKING the suggestion, not with Enter: a lone committed tag makes Enter mean
  // "open that category's list", which navigates away from the search view entirely.
  await jisho.getByRole("menuitem", { name: /Kanji/ }).first().click();
  await expect(box).toContainText("Kanji");

  // Now a WORD filter must no longer offer itself: godan is a property of words, so
  // `#kanji #verb-godan` can never match. The host reports 0 and the menu drops it — no
  // hand-written rule per pair.
  await box.pressSequentially("#verb");
  await expect(jisho.getByRole("menuitem", { name: /Godan/ })).toHaveCount(0);
});

test("capture: #kanji opens a kanji list", async ({ vscode, jisho }) => {
  // WHY (#27): the result-type tag has to RETURN its type. It suggested and filtered correctly for
  // a while before opening anything — the list was empty because `browse()` only knew about words.
  await openBrowseTab(jisho);
  await jisho.getByRole("button", { name: /Browse Result type/i }).click();
  await jisho.getByRole("button", { name: /Kanji, [\d,]+ words/ }).click();
  await currentCrumb(jisho, "Kanji").waitFor();
  await expect(jisho.getByRole("option").first()).toBeVisible();

  // The ordering controls are absent: a kanji has no reading to sort gojūon by, so offering あ–ん
  // would be a control that cannot do anything.
  await expect(jisho.getByRole("group", { name: "Sort order" })).toHaveCount(0);

  await screenshotSidebar(
    vscode.window,
    "test-results/shots/38-kanji-list.png"
  );
});

test("a word page's grammar tag browses its category", async ({ jisho }) => {
  // WHY (#27): tapping "ichidan verb" on 食べる asks "what else is an ichidan verb?" — the question
  // a reader has at that moment, and previously only answerable by typing the tag by hand.
  await jisho.getByRole("searchbox").click();
  await jisho.getByRole("searchbox").pressSequentially("食べる");
  await jisho
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await jisho.getByRole("heading", { name: "Info" }).waitFor();

  await jisho
    .getByRole("button", { name: /ichidan verb/i })
    .first()
    .click();
  // Lands on that category's list, with its own heading and rows.
  await expect(currentCrumb(jisho, "Ichidan verbs")).toBeVisible();
  await expect(jisho.getByRole("option").first()).toBeVisible();

  // Arrived by GRAPH traversal — a pill on a word page, from the Search tab — so the trail's root
  // is the home control rather than a section name. Naming "Vocab" here would claim the reader
  // drilled through a tab they never opened. (#55)
  await expect(
    jisho.getByRole("link", { name: "Back to search" })
  ).toBeVisible();
});

test("capture: #place opens a name list", async ({ vscode, jisho }) => {
  // Skipped without the names DB — see `hasNamesDb`. The tag genuinely does not exist then, so
  // this would be asserting against a UI the extension deliberately did not render.
  test.skip(
    !hasNamesDb,
    "requires assets/jisho-names.db (vp run build:data:names)"
  );
  // WHY (#27): the last result type that promised more than it delivered. `#name`/`#place` read the
  // separate names DB, which `browse()` does not touch — they suggested and opened nothing.
  await openBrowseTab(jisho);
  await jisho.getByRole("button", { name: /Browse Result type/i }).click();
  await jisho.getByRole("button", { name: /Places, [\d,]+ words/ }).click();
  await currentCrumb(jisho, "Places").waitFor();
  await expect(jisho.getByRole("option").first()).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/39-place-list.png"
  );
});
