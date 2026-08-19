import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVSCode, type Launched } from "./launch";
import { openJishoSidebar } from "./webview";

/**
 * The DEFAULT state of comment highlighting: off (spec 18).
 *
 * A separate file rather than a case in `code-comments.e2e.ts`, because the harness drives one
 * VS Code at a time — `assertPortFree` refuses a second instance on the shared debug port — and
 * this needs a window launched with the setting OFF from the start. The setting is also read at
 * activation, so seeding it is closer to what a user installs into than toggling it live.
 */
test.describe.configure({ mode: "serial" });

const FIXTURE = "checkout.ts";

let vscode: Launched | undefined;

test.beforeAll(async () => {
  vscode = await launchVSCode(
    {
      "vscode-jisho.highlighting.enabled": true,
      "vscode-jisho.highlighting.codeComments": false
    },
    { builtinExtensions: true }
  );
  writeFileSync(
    join(vscode.workspaceDir, FIXTURE),
    readFileSync(
      join(process.cwd(), "e2e", "docs", "fixtures", FIXTURE),
      "utf8"
    ),
    "utf8"
  );
  // File FIRST, panel second. Quick-open keystrokes die when focus sits inside a webview, and
  // opening our panel puts it there; doing it in this order means the picker only ever runs in a
  // window whose focus has never left the workbench.
  const win = vscode.window;
  await win.locator(".editor-group-container").first().click();
  await win.keyboard.press("ControlOrMeta+P");
  await win.keyboard.type(FIXTURE);
  const row = win
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: FIXTURE })
    .first();
  await row.waitFor({ state: "attached" });
  await row.click({ force: true });
  await win
    .locator(".view-line")
    .filter({ hasText: "注文処理" })
    .first()
    .waitFor({ timeout: 20_000 });
  // Only now the panel, which is what ACTIVATES the extension (`activationEvents` is empty).
  await openJishoSidebar(win);
});

test.afterAll(async () => {
  await vscode?.close();
});

test("with the setting off, nothing in a code file is coloured", async () => {
  // WHY: `highlighting.codeComments` is opt-in, so OFF is the state every user starts in. A feature
  // that only ever ADDS colouring would pass every test in the companion file while a user who
  // never asked for it finds their source files painted.
  const win = vscode!.window;
  const line = win
    .locator(".view-line")
    .filter({ hasText: "在庫を確認してから決済に進みます" })
    .first();
  await line.waitFor({ timeout: 20_000 });
  // Settle before asserting an absence, so zero means "decided against" rather than "not yet".
  await win.waitForTimeout(3000);
  expect(
    await line.evaluate(
      (el) => el.querySelectorAll('[class*="TextEditorDecorationType"]').length
    )
  ).toBe(0);
});
