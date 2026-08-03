import { test } from "../fixtures";
import { fillSearch, openKanjiResult, screenshotSidebar } from "../webview";

/**
 * Light-theme contrast audit.
 *
 * Stock "Default Light Modern" ships in every install; derived colors (--jisho-inflection and
 * friends) must stay legible there, not just on dark themes. It used to need its own VS Code because
 * driving the theme PICKER raced quick-input focus; `setTheme` rewrites the profile's settings.json
 * and waits for the workbench to report the new kind, so it is four more captures rather than a
 * second 8-second boot.
 *
 * The `afterAll` is load-bearing now that one instance is shared across files. Switching the theme
 * mutates state every other suite reads, and Playwright makes no promise about file order — leaving
 * it light would silently repaint whichever suite happened to run next.
 */
test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ vscode }) => {
  await vscode.setTheme("light");
});

test.afterAll(async ({ vscode }) => {
  await vscode.setTheme("dark");
});

test("capture: word detail in light theme (contrast audit)", async ({
  vscode,
  jisho
}) => {
  await fillSearch(jisho, "食べる");
  await jisho
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await jisho.getByRole("heading", { name: "Conjugations" }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/16-word-detail-light.png"
  );
});

test("capture: more examples page in light theme (F1)", async ({
  vscode,
  jisho
}) => {
  await fillSearch(jisho, "食べる");
  await jisho
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await jisho.getByRole("button", { name: /more examples/i }).click();
  await jisho.getByRole("heading", { name: /Examples for/ }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/16d-more-examples-light.png"
  );
});

test("capture: kanji similar section in light theme (F3)", async ({
  vscode,
  jisho
}) => {
  await openKanjiResult(jisho, "未");
  await jisho.getByRole("heading", { name: "Similar kanji" }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/16c-kanji-similar-light.png"
  );
});

test("capture: stroke order in light theme", async ({ vscode, jisho }) => {
  await openKanjiResult(jisho, "近");
  await jisho.getByRole("button", { name: /stroke order/i }).click();
  await jisho.getByRole("slider").waitFor();
  // Park the pointer: it comes to rest over the canvas after the click, which hover-highlights a
  // part and makes the capture nondeterministic.
  await vscode.window.mouse.move(0, 0);
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/16b-stroke-order-light.png"
  );
});
