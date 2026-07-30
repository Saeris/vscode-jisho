import { test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import {
  jishoFrame,
  openJishoSidebar,
  returnToSearch,
  screenshotSidebar
} from "./webview";

/**
 * The visual-iteration loop: drive each surface and capture the sidebar so the UI can be reviewed
 * against real pixels. These are deliberately NOT assertions — they're a screenshot harness for
 * refining layout/spacing/theming. Visual-regression baselines come later, after the polish work
 * (locking baselines of a UI we're about to change would be backwards).
 *
 * Run: vp exec playwright test visual.e2e.ts   → shots land in test-results/shots/
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode();
  await openJishoSidebar(app().window);
});

test.afterAll(async () => {
  await vscode?.close();
});

test("capture: empty search", async () => {
  await jishoFrame(app().window);
  await screenshotSidebar(app().window, "test-results/shots/10-empty.png");
});

test("capture: search results (words + kanji sections)", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("食べる");
  await frame.getByRole("option").first().waitFor();
  await screenshotSidebar(app().window, "test-results/shots/11-results.png");
});

test("capture: word detail (pitch contour, JLPT badge, examples)", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/12-word-detail.png"
  );
});

test("capture: more examples page (Tatoeba pool + furigana, F1)", async () => {
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame.getByRole("button", { name: "More examples" }).click();
  await frame.getByRole("heading", { name: /Examples for/ }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/12e-more-examples.png"
  );
});

test("capture: word detail — conjugation table", async () => {
  // Examples render inline on the base word-detail capture now, and the conjugation table is a
  // visible section — no disclosure to open first.
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame.getByRole("heading", { name: "Conjugations" }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/12c-word-detail-conjugations.png"
  );

  // Form-label grammar hint (Term tooltip opens after its 300ms delay).
  await frame.getByRole("button", { name: "Te-form" }).hover();
  await frame.getByText(/the connector/i).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/12d-conjugation-hint.png"
  );
});

test("capture: kanji detail (readings, copy, stroke-order link)", async () => {
  const frame = await jishoFrame(app().window);
  // Get back to search first — a previous capture may have left a detail view on the stack.
  await returnToSearch(frame);

  await frame.getByRole("searchbox").fill("食");
  // Target the Kanji section's listbox specifically. Both sections render `role=option`, and the
  // kanji row's accessible name is the whole row ("食eat, foodショク、ジキ…"), not just the literal —
  // so match by the section's aria-label and take its first option (confirmed via a DOM dump).
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
  await frame.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/13-kanji-detail.png"
  );
});

test("capture: kanji detail — similar kanji section (F3)", async () => {
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);

  // 未 has the classic confusable 末 at the top of its similar list.
  await frame.getByRole("searchbox").fill("未");
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
  await frame.getByRole("heading", { name: "Similar kanji" }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/13b-kanji-similar.png"
  );
});

test("capture: stroke order sub-page (player + chart)", async () => {
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);

  await frame.getByRole("searchbox").fill("近");
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
  // From the kanji detail, into the stroke-order view.
  await frame.getByRole("button", { name: /stroke order/i }).click();
  await frame.getByRole("slider").waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/15-stroke-order.png"
  );

  // Part highlighting: hovering the inner 斤 hit-box must tint its strokes (radical ⻌'s box
  // covers most of the canvas but paints underneath, so the inner part wins the hover).
  // .first(): the chart cells repeat the SVG (their rects are display:none); the player's is first.
  await frame
    .locator('svg.acjk .parts rect[data-literal="斤"]')
    .first()
    .hover();
  await screenshotSidebar(
    app().window,
    "test-results/shots/15b-stroke-part-hover.png"
  );
});

test("capture: handwriting view", async () => {
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);
  // By accessible name, not by its ✏️ glyph: the emoji is presentation that a restyle could change,
  // while the label is the contract screen-reader users rely on. Matching the label also means this
  // fails loudly if the button is renamed, rather than silently finding nothing and timing out.
  await frame.getByRole("button", { name: "Draw a kanji to search" }).click();
  await frame.getByText(/stroke order and count/i).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/14-handwriting.png"
  );
});

test("capture: copy-as menu on the word detail", async () => {
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame
    .getByRole("button", { name: /Copy 食べる as/ })
    .first()
    .click();
  await frame
    .getByRole("menuitem", { name: /Furigana \(Markdown\)/ })
    .waitFor();
  await screenshotSidebar(app().window, "test-results/shots/17-copy-as.png");
  // Close the menu we opened. It is an overlay, so leaving it up makes the NEXT test's first click
  // land on the menu instead of the page — a failure with no visible connection to this test.
  const menu = frame.getByRole("menu");
  await menu.press("Escape");
  await menu.waitFor({ state: "hidden" });
});

/**
 * Light-theme contrast audit, in the SAME launch as the dark captures above.
 *
 * It used to need its own VS Code instance because driving the theme picker raced quick-input focus.
 * `setTheme` sidesteps the picker entirely — it rewrites the profile's settings.json and waits for
 * the workbench to report the new theme kind — so the audit is now four more captures rather than a
 * second 8-second boot. Stock "Default Light Modern" ships in every install; derived colors
 * (--jisho-inflection and friends) must stay legible here, not just on dark themes.
 *
 * Declared last on purpose: the suite is serial, so everything above captures dark.
 */
test.describe("light theme", () => {
  test.beforeAll(async () => {
    await app().setTheme("light");
  });

  test("capture: word detail in light theme (contrast audit)", async () => {
    const frame = await jishoFrame(app().window);
    await returnToSearch(frame);
    await frame.getByRole("searchbox").fill("食べる");
    await frame
      .getByRole("option", { name: /食べる/ })
      .first()
      .click();
    await frame.getByRole("heading", { name: "Conjugations" }).waitFor();
    await screenshotSidebar(
      app().window,
      "test-results/shots/16-word-detail-light.png"
    );
  });

  test("capture: more examples page in light theme (F1)", async () => {
    const frame = await jishoFrame(app().window);
    await returnToSearch(frame);
    await frame.getByRole("searchbox").fill("食べる");
    await frame
      .getByRole("option", { name: /食べる/ })
      .first()
      .click();
    await frame.getByRole("button", { name: "More examples" }).click();
    await frame.getByRole("heading", { name: /Examples for/ }).waitFor();
    await screenshotSidebar(
      app().window,
      "test-results/shots/16d-more-examples-light.png"
    );
  });

  test("capture: kanji similar section in light theme (F3)", async () => {
    const frame = await jishoFrame(app().window);
    await returnToSearch(frame);
    await frame.getByRole("searchbox").fill("未");
    await frame
      .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
      .first()
      .click();
    await frame.getByRole("heading", { name: "Similar kanji" }).waitFor();
    await screenshotSidebar(
      app().window,
      "test-results/shots/16c-kanji-similar-light.png"
    );
  });

  test("capture: stroke order in light theme", async () => {
    const frame = await jishoFrame(app().window);
    await returnToSearch(frame);
    await frame.getByRole("searchbox").fill("近");
    await frame
      .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
      .first()
      .click();
    await frame.getByRole("button", { name: /stroke order/i }).click();
    await frame.getByRole("slider").waitFor();
    // Park the pointer: it comes to rest over the canvas after the click, which hover-highlights a
    // part and makes the capture nondeterministic.
    await app().window.mouse.move(0, 0);
    await screenshotSidebar(
      app().window,
      "test-results/shots/16b-stroke-order-light.png"
    );
  });
});
