import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVSCode, type Launched } from "./launch";
import { openJishoSidebar } from "./webview";

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

const FIXTURE = "checkout.ts";

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode(
    {
      "vscode-jisho.highlighting.enabled": true,
      "vscode-jisho.highlighting.codeComments": true
    },
    // The one suite that needs VS Code's built-in extensions. Grammars are contributed BY
    // extensions, so under the harness's usual `--disable-extensions` there is no `source.ts` to
    // find and the feature under test correctly does nothing at all.
    { builtinExtensions: true }
  );
  const win = app().window;
  // The harness opens a fresh temp folder as its workspace, so the fixture has to be COPIED into it
  // — Quick Open searches the workspace, and a repo-relative path finds nothing there.
  writeFileSync(
    join(app().workspaceDir, FIXTURE),
    readFileSync(
      join(process.cwd(), "e2e", "docs", "fixtures", FIXTURE),
      "utf8"
    ),
    "utf8"
  );
  // File FIRST, panel second, and the order is load-bearing: quick-open keystrokes die when focus
  // sits inside a webview, and opening our panel puts it there. Opened from disk rather than typed,
  // since the block comments and string literals are the point and retyping them through the
  // keyboard would fight the editor's auto-closing.
  await openFixture(win);
  // The panel is what ACTIVATES the extension — `activationEvents` is empty, so opening a .ts file
  // does not start it, and without this the decorator does not exist to paint anything.
  await openJishoSidebar(win);
});

/**
 * Open the fixture through Quick Open.
 *
 * CLICKS the picker row rather than pressing Enter, and focuses the editor group first. Both are
 * the docs suite's hard-won idiom (`e2e/docs/manual.docs.e2e.ts`): Enter races the filtering, so the
 * row is on screen while the keystroke lands before the list has settled on it, and quick-open
 * keystrokes die outright when focus sits inside a webview — which it does after opening our panel.
 */
const openFixture = async (win: Launched["window"]): Promise<void> => {
  const row = win
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: FIXTURE })
    .first();

  // Retried as a whole. Quick Open searches an index built asynchronously, so the first file a
  // suite opens can be typed before the index knows about it — and the row then never arrives,
  // however long the wait. Reopening the picker re-runs the search against a warmer index.
  for (let attempt = 0; attempt < 3; attempt++) {
    await win.locator(".editor-group-container").first().click();
    await win.keyboard.press("ControlOrMeta+P");
    await win.keyboard.type(FIXTURE);
    try {
      // `force`, because the row resolves and reports `focused` while Playwright still judges it
      // unactionable — the picker animates in, and a strict actionability check waits out the whole
      // timeout on an element that is already the selected one. Waiting for it first keeps the
      // click from racing the filter, which is the failure a bare Enter produces.
      await row.waitFor({ state: "attached", timeout: 5000 });
      await row.click({ force: true });
      // The fixture's OWN text, not just editor chrome: `.monaco-editor` exists for the welcome tab
      // and the settings editor too, so waiting on it can be satisfied by a pane that never got the
      // file.
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

/**
 * How many part-of-speech decorations OF OURS are on the first line containing `text`.
 *
 * Counted by the `ced-…TextEditorDecorationType…` class VS Code stamps on a decorated range, not by
 * reading colours. Colour was the first approach and it measured the wrong thing: a string literal
 * already carries three of the THEME's own token colours (`mtk10`, `mtk25`, `mtk28`), so a helper
 * that counted distinct colours reported "coloured" for a line our decorator had never touched.
 * The class is unambiguous — it exists only where an extension painted a range.
 */
const decoratedSpans = async (text: string): Promise<number> => {
  const win = app().window;
  // Monaco VIRTUALISES: a line below the fold is not in the DOM at all, and our decorator only
  // paints `visibleRanges` — so an off-screen line would report zero for two unrelated reasons.
  await win.locator(".editor-group-container").first().click();
  await win.keyboard.press("ControlOrMeta+Home");
  const line = win.locator(".view-line").filter({ hasText: text }).first();
  if ((await line.count()) === 0)
    for (let page = 0; page < 10 && (await line.count()) === 0; page++)
      await win.keyboard.press("PageDown");
  await line.waitFor();
  return line.evaluate(
    (el) => el.querySelectorAll('[class*="TextEditorDecorationType"]').length
  );
};

test("a line comment is coloured by part of speech", async () => {
  // WHY: the feature's reason to exist. That comment segments into ten morphemes — 在庫/を/確認/し/
  // て/から/決済/に/進み/ます — spanning noun, particle, verb and auxiliary, and each gets its own
  // decorated span. Nine or more allows for the tokenizer merging a boundary without letting a
  // near-empty result pass.
  //
  // A longer timeout than the cases below, because this is the FIRST decoration pass of the run and
  // it pays two one-off costs the others do not: the tokenizer loading its 12MB IPADIC dictionary,
  // and the grammar loading its oniguruma WASM. Both are lazy by design. 20s was enough locally and
  // not on the Linux CI runner with a cold disk, where this returned 0 and the suite failed.
  await expect
    .poll(async () => decoratedSpans("在庫を確認してから決済に進みます"), {
      timeout: 60_000
    })
    .toBeGreaterThanOrEqual(9);
});

test("a JSDoc comment is coloured too", async () => {
  // WHY: `/** … */` is a different scope (`comment.block.documentation`) from `//`, and matching
  // the `comment` PREFIX rather than an exact scope is what covers both. An exact match would pass
  // the test above and silently skip every doc comment in the file.
  //
  // This line also sits BELOW the first comment in the file, which is what catches the span/line
  // misalignment that shipped in the first draft: dropping empty lines from the per-line span array
  // shifted every later comment onto the wrong line, so only the first comment of each kind worked.
  await expect
    .poll(async () => decoratedSpans("在庫を確認します"), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(8);
});

test("markdown inside a doc comment is coloured through its formatting", async () => {
  // WHY: JSDoc is Markdown in practice — bold, inline code, lists and links all appear in real doc
  // comments. The emphasis markers are stripped for ANALYSIS (`stripRuby`), so `**在庫**を確認します`
  // must read as one Japanese run rather than three fragments; a decorator that tokenized around
  // the asterisks would split 在庫 from its particle and mislabel both.
  await expect
    .poll(async () => decoratedSpans("を確認します。`注文`"), {
      timeout: 20_000
    })
    .toBeGreaterThanOrEqual(6);

  // A list item, which is the other shape doc-comment prose takes.
  await expect
    .poll(async () => decoratedSpans("決済に進みます"), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(4);
});

test("a fenced code block inside a doc comment is left alone", async () => {
  // WHY: a fence holds CODE, and colouring code is the thing this feature exists not to do — the
  // same principle that excludes string literals. The grammar is no help here: measured, every line
  // of a fenced block inside JSDoc is uniformly `comment.block.documentation.ts`, fences included,
  // because TextMate does not descend into Markdown nested in a doc comment. So the fence state is
  // tracked by hand, and this is what proves it.
  await app().window.waitForTimeout(2000);
  expect(await decoratedSpans('const 変数 = "在庫"')).toBe(0);

  // And the fence CLOSES: prose after it is coloured again, which a one-way flag would miss.
  await expect
    .poll(async () => decoratedSpans("送信します"), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
});

test("Japanese in a string literal is left alone", async () => {
  // WHY: the boundary, and the half a delimiter table would get wrong. `outOfStock` holds a
  // Japanese sentence that the tokenizer would happily segment — colouring it would change how the
  // CODE reads, which is the thing the user explicitly did not ask for.
  //
  // Ordered AFTER the two tests above, deliberately: they prove a pass has run and painted this
  // very file, so a zero here means "decided against this line" rather than "nothing ran yet".
  await app().window.waitForTimeout(3000);
  expect(await decoratedSpans("申し訳ありませんが")).toBe(0);
});
