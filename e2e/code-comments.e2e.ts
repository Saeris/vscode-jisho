import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { launchVSCode, type Launched } from "./launch";

/**
 * Part-of-speech colouring inside code comments (spec 18).
 *
 * The whole feature is a boundary question — comments yes, strings no — and that boundary only
 * exists once a real grammar has tokenized a real file. A unit test would have to mock the thing
 * under test, so the assertions that matter live here.
 *
 * Driven against `e2e/docs/fixtures/checkout.ts`, which spec 17 kept for exactly this moment: it
 * holds JSDoc, line comments and Japanese STRING LITERALS in one file, so one fixture covers both
 * halves of the boundary.
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode({
    "vscode-jisho.highlighting.enabled": true,
    "vscode-jisho.highlighting.codeComments": true
  });
  const win = app().window;
  // Open the fixture from disk rather than typing it: the block comments and the string literals
  // are the point, and retyping them through the keyboard would fight the editor's auto-closing.
  await win.keyboard.press("ControlOrMeta+P");
  await win.locator(".quick-input-widget").waitFor();
  await win.keyboard.type(join("e2e", "docs", "fixtures", "checkout.ts"));
  await win.keyboard.press("Enter");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
});

test.afterAll(async () => {
  await vscode?.close();
});

/**
 * Distinct non-greyscale colours on the first line containing `text`.
 *
 * Greyscale is excluded because the theme paints an uncoloured comment grey — counting it would
 * make "not coloured by us" indistinguishable from "coloured". Read through a canvas because our
 * palette serialises as `oklch()`, which does not parse as `rgb()`.
 */
const paletteColours = async (text: string): Promise<number> => {
  const line = app()
    .window.locator(".view-line")
    .filter({ hasText: text })
    .first();
  await line.waitFor();
  return line.evaluate((el) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const seen = new Set<string>();
    for (const span of el.querySelectorAll("span")) {
      if (span.textContent.trim() === "") continue;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = getComputedStyle(span).color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      if (Math.max(r, g, b) - Math.min(r, g, b) < 10) continue;
      seen.add(`${r},${g},${b}`);
    }
    return seen.size;
  });
};

test("a line comment is coloured by part of speech", async () => {
  // WHY: the feature's reason to exist. `在庫を確認してから決済に進みます` spans noun, particle and
  // verb, so several distinct palette colours must land on one comment line.
  await expect
    .poll(async () => paletteColours("在庫を確認してから決済に進みます"), {
      timeout: 20_000
    })
    .toBeGreaterThanOrEqual(3);
});

test("a JSDoc comment is coloured too", async () => {
  // WHY: `/** … */` is a different scope (`comment.block.documentation`) from `//`, and matching
  // the `comment` PREFIX rather than an exact scope is what covers both. An exact match would pass
  // the test above and silently skip every doc comment in the file.
  await expect
    .poll(async () => paletteColours("在庫を確認します"), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
});

test("Japanese in a string literal is left alone", async () => {
  // WHY: the boundary, and the half a delimiter table would get wrong. `outOfStock` holds a
  // Japanese sentence that the tokenizer would happily segment — colouring it would change how the
  // CODE reads, which is the thing the user explicitly did not ask for.
  //
  // Given a generous settle window rather than asserted immediately: a pass that has not run yet
  // would also report zero, so this waits long enough that zero means "decided against".
  await app().window.waitForTimeout(3000);
  expect(await paletteColours("申し訳ありませんが")).toBe(0);
});

test("turning the setting off clears the colouring", async () => {
  // WHY: `highlighting.codeComments` is opt-in, so the off state is the DEFAULT every user starts
  // from. A setting that only ever adds colouring would pass every test above while leaving anyone
  // who turns it back off with colour they cannot remove.
  const win = app().window;
  await win.keyboard.press("F1");
  await win.locator(".quick-input-widget").waitFor();
  await win.keyboard.type("Preferences: Open User Settings (JSON)");
  await win.keyboard.press("Enter");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  // Settings JSON is a real editor; edit it the way a user would.
  await win.keyboard.press("ControlOrMeta+a");
  await win.keyboard.type(
    JSON.stringify({
      "vscode-jisho.highlighting.enabled": true,
      "vscode-jisho.highlighting.codeComments": false
    })
  );
  await win.keyboard.press("ControlOrMeta+s");

  await win.keyboard.press("ControlOrMeta+P");
  await win.locator(".quick-input-widget").waitFor();
  await win.keyboard.type(join("e2e", "docs", "fixtures", "checkout.ts"));
  await win.keyboard.press("Enter");

  await expect
    .poll(async () => paletteColours("在庫を確認してから決済に進みます"), {
      timeout: 20_000
    })
    .toBe(0);
});
