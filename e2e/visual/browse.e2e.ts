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

test("capture: a word list, by frequency then gojuon", async ({
  vscode,
  jisho
}) => {
  await jisho
    .getByRole("button", { name: /browse words by category/i })
    .click();
  await jisho.getByRole("button", { name: /Browse JLPT level/i }).click();
  await jisho.getByRole("button", { name: /N5, \d+ words/ }).click();
  await jisho.getByRole("heading", { name: "N5" }).waitFor();
  // Frequency order is the default: the words a learner meets first lead the list. `option`, not
  // `menuitem` — the WORD list is a ListBox; only the tag autocomplete is a Menu.
  await expect(jisho.getByRole("option").first()).toBeVisible();
  await screenshotSidebar(vscode.window, "test-results/shots/32-word-list.png");

  // Gojūon order reveals the kana jump rail — the rail is only meaningful once the list is sorted
  // by reading, so the two are deliberately one control.
  await jisho.getByRole("button", { name: "あ–ん" }).click();
  await expect(
    jisho.getByRole("navigation", { name: /jump to kana/i })
  ).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/33-word-list-gojuon.png"
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
  await box.pressSequentially("#");
  await expect(jisho.getByRole("menuitem").first()).toBeVisible();

  const selected = async (): Promise<string | null> =>
    jisho.locator('[role="menuitem"][data-focused]').first().textContent();

  // Nothing is highlighted until the keyboard enters the list — the combobox contract, and what
  // makes the first ↓ meaningful rather than a no-op that skips an entry.
  await box.press("ArrowDown");
  await expect.poll(selected).toContain("N5");
  await box.press("ArrowDown");
  await expect.poll(selected).toContain("N4");
  await box.press("ArrowUp");
  await expect.poll(selected).toContain("N5");

  // Enter commits whatever is highlighted — N5 after the ↓↓↑ above, not the first item blindly.
  await box.press("Enter");
  await expect(box).toContainText("N5");
});
