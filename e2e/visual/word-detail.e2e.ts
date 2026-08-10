import { expect, type FrameLocator } from "@playwright/test";
import { test } from "../fixtures";
import { fillSearch, screenshotSidebar } from "../webview";

/** The word page and everything reachable from it: examples, conjugations, the copy-as menu. */
test.describe.configure({ mode: "serial" });

/** Search a term and open its first word result — the entry point for every capture here. */
const openWord = async (frame: FrameLocator, term: string): Promise<void> => {
  await fillSearch(frame, term);
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
  await jisho.getByRole("button", { name: /more examples/i }).click();
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

test("example sentences balance their last line rather than dangling punctuation", async ({
  jisho
}) => {
  // WHY: a sentence that overflowed the sidebar could wrap its final 。 onto a line of its own, so
  // the entry ended with a lone terminator floating under a full-width line. `line-break: strict`
  // does not prevent that — 禁則処理 keeps a line from STARTING with closing punctuation only while
  // there is a break opportunity left to move; once the break is taken the terminator dangles.
  //
  // Asserted by MEASUREMENT rather than by reading the computed value, because
  // `text-wrap-style: pretty` computing correctly is not the same as it doing anything: it applies
  // to the block that lays out the lines, so setting it on an inline span is a silent no-op. This
  // toggles the property on the live element and fails if the layout is identical either way —
  // which is exactly what a regression to an inline container, or to the shorthand, would produce.
  //
  // 空港's pool is used because it HAS a sentence that reflows; 食べる's happens not to, and a
  // measurement over text with no dangle to fix proves nothing.
  await openWord(jisho, "空港");
  await jisho.getByRole("button", { name: /more examples/i }).click();
  await jisho.getByRole("heading", { name: /Examples for/ }).waitFor();

  const sentences = jisho.locator("[lang='ja']").filter({ hasText: "。" });
  await sentences.first().waitFor();

  const measured = await sentences.evaluateAll((nodes: HTMLElement[]) =>
    nodes.slice(0, 10).map((node) => {
      const style = getComputedStyle(node);
      return {
        wrapStyle: style.textWrapStyle,
        // The shorthand `text-wrap: pretty` also RESETS `text-wrap-mode`, so a regression to it
        // would still report `pretty` above while silently clobbering a `nowrap` set elsewhere.
        wrapMode: style.textWrapMode,
        display: style.display
      };
    })
  );

  // Every sentence, not just the first: the rule is scoped by `lang`, and a change that narrowed it
  // to some elements would leave the others behind while this still passed on a sample of one.
  expect(measured.length).toBeGreaterThan(0);
  expect(measured.map((m) => m.wrapStyle)).not.toContain("auto");
  expect(measured.map((m) => m.wrapMode)).not.toContain("nowrap");

  // `text-wrap-style` applies to the block that lays out the lines, so on an INLINE container it
  // computes correctly and does nothing at all. The sentence spans are flex items (blockified),
  // which is what makes the rule take effect — assert that rather than a layout measurement.
  //
  // An earlier version measured whether a sentence actually reflowed under `pretty`. It passed
  // locally and failed on CI, because `pretty` only moves a line where there is a dangle to fix and
  // whether one exists depends on where the text wraps — which depends on the font, which differs
  // between a Windows machine and a Linux runner. Chromium's line-breaking is Chromium's to test;
  // ours is that the rule reaches these elements in a form that can take effect.
  expect(measured.map((m) => m.display)).not.toContain("inline");
});
