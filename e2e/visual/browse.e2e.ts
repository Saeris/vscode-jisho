import { expect, test } from "../fixtures";
import { screenshotSidebar } from "../webview";

/**
 * Browsing by category (#54): the tree, a group, and a word list in both orderings.
 *
 * Serial because each capture drills one level deeper than the last — the navigation stack IS the
 * subject here, not incidental setup.
 */
test.describe.configure({ mode: "serial" });

test("capture: browse tree", async ({ vscode, jisho }) => {
  await jisho
    .getByRole("button", { name: /browse words by category/i })
    .click();
  await jisho.getByRole("heading", { name: "Browse" }).waitFor();
  await screenshotSidebar(vscode.window, "test-results/shots/30-browse.png");
});

test("capture: a group's categories, with counts", async ({
  vscode,
  jisho
}) => {
  await jisho
    .getByRole("button", { name: /browse words by category/i })
    .click();
  await jisho.getByRole("button", { name: /Browse JLPT level/i }).click();
  await jisho.getByRole("heading", { name: "JLPT level" }).waitFor();
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
  await jisho
    .getByRole("button", { name: /browse words by category/i })
    .click();
  await jisho.getByRole("button", { name: /Browse JLPT level/i }).click();
  await jisho.getByRole("button", { name: /N5, \d+ words/ }).click();
  await jisho.getByRole("heading", { name: "N5" }).waitFor();
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
  await jisho
    .getByRole("button", { name: /browse words by category/i })
    .click();
  await jisho.getByRole("button", { name: /Browse JLPT level/i }).click();
  await jisho.getByRole("button", { name: /N5, \d+ words/ }).click();
  await jisho.getByRole("heading", { name: "N5" }).waitFor();

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
  await jisho
    .getByRole("button", { name: /browse words by category/i })
    .click();
  await jisho.getByRole("button", { name: /Browse Result type/i }).click();
  await jisho.getByRole("button", { name: /Kanji, [\d,]+ words/ }).click();
  await jisho.getByRole("heading", { name: "Kanji" }).waitFor();
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
  await expect(
    jisho.getByRole("heading", { name: "Ichidan verbs" })
  ).toBeVisible();
  await expect(jisho.getByRole("option").first()).toBeVisible();
});

test("capture: #place opens a name list", async ({ vscode, jisho }) => {
  // WHY (#27): the last result type that promised more than it delivered. `#name`/`#place` read the
  // separate names DB, which `browse()` does not touch — they suggested and opened nothing.
  await jisho
    .getByRole("button", { name: /browse words by category/i })
    .click();
  await jisho.getByRole("button", { name: /Browse Result type/i }).click();
  await jisho.getByRole("button", { name: /Places, [\d,]+ words/ }).click();
  await jisho.getByRole("heading", { name: "Places" }).waitFor();
  await expect(jisho.getByRole("option").first()).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/39-place-list.png"
  );
});
