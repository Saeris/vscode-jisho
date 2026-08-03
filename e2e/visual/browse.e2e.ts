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
  // Frequency order is the default: the words a learner meets first lead the list.
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
  await expect(
    jisho.getByRole("listbox", { name: "Matching tags" })
  ).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/34-tag-autocomplete.png"
  );

  // Completing one turns it into a token — atomic, and carrying the resolved classifier. The token
  // renders the classifier's LABEL ("N5"), not the raw id it was typed as, so the committed filter
  // reads the same way the browse tree names it.
  await jisho.getByRole("option", { name: "N5" }).first().click();
  await expect(jisho.getByRole("searchbox")).toContainText("N5");
  await screenshotSidebar(vscode.window, "test-results/shots/35-tag-token.png");
});
