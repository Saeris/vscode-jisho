import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVSCode, type Launched } from "./launch";
import { hoverEditorWord, openJishoSidebar } from "./webview";

/**
 * Dictionary hovers inside code comments.
 *
 * Reported after 0.2.1: the COLOURING learned to read comments and the hover did not, because the
 * two features had separate language lists and only one was updated. The hover was registered for
 * `["markdown", "plaintext"]`, so in a `.ts` file it never ran at all.
 *
 * The interesting assertion is the second one. A hover has a competitor that colouring does not —
 * TypeScript's own language service owns string literals and identifiers, and answers there. So
 * "we do nothing outside a comment" is not merely tidiness: it is what keeps us from fighting the
 * language service over a position it should win.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE = "checkout.ts";

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode(
    {
      "vscode-jisho.hover.enabled": true,
      "vscode-jisho.highlighting.codeComments": true
    },
    // Grammars are contributed BY extensions, so the harness's usual `--disable-extensions` would
    // leave VS Code with none and the comment gate would correctly refuse every position.
    { builtinExtensions: true }
  );
  const win = app().window;
  writeFileSync(
    join(app().workspaceDir, FIXTURE),
    readFileSync(
      join(process.cwd(), "e2e", "docs", "fixtures", FIXTURE),
      "utf8"
    ),
    "utf8"
  );
  // File FIRST, panel second: quick-open keystrokes die when focus sits inside a webview.
  await openFixture(win);
  await openJishoSidebar(win);
});

/** Open the fixture through Quick Open, retried — the index is built asynchronously. */
const openFixture = async (win: Launched["window"]): Promise<void> => {
  const row = win
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: FIXTURE })
    .first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await win.locator(".editor-group-container").first().click();
    await win.keyboard.press("ControlOrMeta+P");
    await win.keyboard.type(FIXTURE);
    try {
      await row.waitFor({ state: "attached", timeout: 5000 });
      await row.click({ force: true });
      await win
        .locator(".view-line")
        .filter({ hasText: "注文処理" })
        .first()
        .waitFor({ timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await win.keyboard.press("Escape");
    }
  }
};

test.afterAll(async () => {
  await vscode?.close();
});

test("hovering Japanese in a line comment shows the dictionary hover", async () => {
  // WHY: the report. `在庫` is the first word of a top-level `//` comment, which is why the fixture
  // keeps that line unindented and outside any string — a known character offset to aim at.
  const hover = await hoverEditorWord(
    app().window,
    "// 在庫を確認してから決済に進みます",
    3,
    19,
    "stock"
  );
  await expect(hover).toContainText("在庫");
});

test("hovering Japanese in a string literal does NOT show it", async () => {
  // WHY: the boundary, and the half that matters more for a hover than for colouring. TypeScript's
  // language service owns a string literal and answers there with its own hover; ours appearing
  // too would be two providers competing over one position. Measured during the spec-18 work:
  // hovering inside a literal produced `(property) outOfStock: "…"` from TypeScript.
  //
  // Asserted as an ABSENCE with a dwell, so a hover that is merely slow is not mistaken for one
  // that correctly declined.
  const win = app().window;
  const line = win
    .locator(".view-line")
    .filter({ hasText: "申し訳ありませんが" })
    .first();
  await line.waitFor();
  const span = line.locator("span").first();
  const box = await span.boundingBox();
  if (!box) throw new Error("could not measure the string-literal line");
  // Aim inside the Japanese, past `outOfStock: "` — roughly 60% along the rendered line.
  await win.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await win.waitForTimeout(4000);
  await expect(
    win.locator(".monaco-hover-content").filter({ hasText: "stock (of goods)" })
  ).toHaveCount(0);
});
