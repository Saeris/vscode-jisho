import type { FrameLocator } from "@playwright/test";
import { test } from "../fixtures";
import { screenshotSidebar } from "../webview";

/** The word page and everything reachable from it: examples, conjugations, the copy-as menu. */
test.describe.configure({ mode: "serial" });

/** Search a term and open its first word result — the entry point for every capture here. */
const openWord = async (frame: FrameLocator, term: string): Promise<void> => {
  await frame.getByRole("searchbox").fill(term);
  await frame
    .getByRole("option", { name: new RegExp(term) })
    .first()
    .click();
};

test("capture: word detail (pitch contour, JLPT badge, examples)", async ({
  vscode,
  jisho
}) => {
  await openWord(jisho, "食べる");
  await jisho.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/12-word-detail.png"
  );
});

test("capture: more examples page (Tatoeba pool + furigana, F1)", async ({
  vscode,
  jisho
}) => {
  await openWord(jisho, "食べる");
  await jisho.getByRole("button", { name: "More examples" }).click();
  await jisho.getByRole("heading", { name: /Examples for/ }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/12e-more-examples.png"
  );
});

test("capture: word detail — conjugation table", async ({ vscode, jisho }) => {
  // Examples render inline on the base word-detail capture now, and the conjugation table is a
  // visible section — no disclosure to open first.
  await openWord(jisho, "食べる");
  await jisho.getByRole("heading", { name: "Conjugations" }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/12c-word-detail-conjugations.png"
  );

  // Form-label grammar hint (Term tooltip opens after its 300ms delay).
  await jisho.getByRole("button", { name: "Te-form" }).hover();
  await jisho.getByText(/the connector/i).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/12d-conjugation-hint.png"
  );
});

test("capture: copy-as menu on the word detail", async ({ vscode, jisho }) => {
  await openWord(jisho, "食べる");
  await jisho
    .getByRole("button", { name: /Copy 食べる as/ })
    .first()
    .click();
  await jisho
    .getByRole("menuitem", { name: /Furigana \(Markdown\)/ })
    .waitFor();
  await screenshotSidebar(vscode.window, "test-results/shots/17-copy-as.png");
  // Close the menu we opened. It is an overlay, so leaving it up makes the NEXT test's first click
  // land on the menu instead of the page — a failure with no visible connection to this test.
  const menu = jisho.getByRole("menu");
  await menu.press("Escape");
  await menu.waitFor({ state: "hidden" });
});
