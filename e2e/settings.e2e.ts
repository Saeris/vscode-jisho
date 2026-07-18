import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import { jishoFrame, openJishoSidebar } from "./webview";

/**
 * The settings pipeline end-to-end: a launch with every Jisho setting overridden in the seeded
 * profile proves each delivery path — webview CSS variables (textScale, guideStyle) and host-side
 * gates (hover.enabled) — without touching the Settings UI.
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode({
    "vscode-jisho.appearance.textScale": 1.5,
    "vscode-jisho.strokeOrder.guideStyle": "aligned",
    "vscode-jisho.hover.enabled": false,
    "vscode-jisho.highlighting.enabled": true
  });
  await openJishoSidebar(app().window);
});

test.afterAll(async () => {
  await vscode?.close();
});

test("textScale reaches the webview as a font-size multiplier", async () => {
  const frame = await jishoFrame(app().window);
  // VS Code's default font size is 13px; 1.5× ≈ 19.5px. Anything ≥ 18 proves the multiplier
  // applied (the default 1.08 would be ~14px). Poll: the settings push lands just after the
  // webview becomes queryable, so the very first read can race it.
  await expect
    .poll(
      async () =>
        Number.parseFloat(
          await frame
            .locator("body")
            .evaluate((el) => getComputedStyle(el).fontSize)
        ),
      { timeout: 10_000 }
    )
    .toBeGreaterThanOrEqual(18);
});

test("guideStyle=aligned flips the stroke player's arrow variant", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("近");
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
  await frame.getByRole("button", { name: /stroke order/i }).click();
  await frame.getByRole("slider").waitFor();
  // At playhead 0 only stroke 1's guide shows; aligned visible, offset hidden — the inverse of
  // the default.
  const opacity = async (selector: string): Promise<string> =>
    frame
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).opacity);
  expect(await opacity("svg.acjk .guides path.g1.aligned")).toBe("1");
  expect(await opacity("svg.acjk .guides path.g1.offset")).toBe("0");
});

test("hover.enabled=false suppresses the dictionary hover", async () => {
  const win = app().window;
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("Control+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  await win.keyboard.type("食べました");
  const word = win.locator(".view-line", { hasText: "食べました" }).first();
  await word.waitFor();
  await word.locator("span span").first().hover();
  // The enabled case appears within ~1s (smoke suite); give the disabled case 4s to prove absence.
  await win.waitForTimeout(4000);
  await expect(
    win.locator(".monaco-hover-content").filter({ hasText: "to eat" })
  ).toHaveCount(0);
});

test("highlighting.enabled colors Japanese by part of speech", async () => {
  const win = app().window;
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("Control+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  // noun + particle + conjugated verb: at least three token types land on one line.
  await win.keyboard.type("写真を見せました");
  const word = win
    .locator(".view-line", { hasText: "写真を見せました" })
    .first();
  await word.waitFor();
  // Semantic tokens apply asynchronously; poll until the line renders more than one color.
  await expect
    .poll(
      async () =>
        word.evaluate(
          (el) =>
            new Set(
              [...el.querySelectorAll("span")].map(
                (s) => getComputedStyle(s).color
              )
            ).size
        ),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(1);
  // Reference shot for the POS-coloring design iteration (BACKLOG #38).
  await win.screenshot({ path: "test-results/shots/03-pos-highlighting.png" });
});
