import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVSCode, type Launched } from "./launch";
import { openJishoSidebar } from "./webview";

/**
 * The same comment/string boundary, across languages that are not JavaScript.
 *
 * TextMate does abstract most of this — a `comment` scope prefix matches `//`, `#`, `/* *​/` and
 * `<!-- -->` alike, with no table of delimiters on our side. But "most" was worth checking rather
 * than assuming, and checking found a real exception: a Python DOCSTRING is scoped
 * `string.quoted.docstring`, NOT `comment`, so the prefix alone would have left Python's most
 * common form of prose uncovered. `isProseScope` matches it explicitly, and the docstring case
 * below is what holds that.
 *
 * Every fixture has the same two lines on purpose — one comment with Japanese, one string literal
 * with the same Japanese — so a language that silently colours its strings fails here rather than
 * in someone's editor.
 */
test.describe.configure({ mode: "serial" });

/** Fixture, the comment text it should colour, and the string text it must not. */
const LANGUAGES = [
  { file: "notes.py", comment: "在庫を確認してから決済に進みます" },
  { file: "notes.css", comment: "在庫を確認してから決済に進みます" },
  { file: "notes.html", comment: "在庫を確認してから決済に進みます" },
  { file: "notes.php", comment: "在庫を確認してから決済に進みます" },
  { file: "notes.rs", comment: "在庫を確認してから決済に進みます" }
] as const;

/** The string literal every fixture carries, which must never be coloured. */
const STRING_TEXT = "申し訳ありませんが";

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
    // Grammars are contributed BY extensions, so the harness's usual `--disable-extensions` would
    // leave VS Code with none and the feature under test correctly doing nothing.
    { builtinExtensions: true }
  );
  for (const { file } of LANGUAGES)
    writeFileSync(
      join(app().workspaceDir, file),
      readFileSync(
        join(process.cwd(), "e2e", "docs", "fixtures", file),
        "utf8"
      ),
      "utf8"
    );
  // The panel is what ACTIVATES the extension (`activationEvents` is empty). Done here, before any
  // file is opened, because quick-open keystrokes die while focus sits inside a webview.
  await openJishoSidebar(app().window);
});

test.afterAll(async () => {
  await vscode?.close();
});

/**
 * Open a fixture by name, and wait for its text to be on screen.
 *
 * Retried as a whole rather than waiting longer on the row. Quick Open searches a workspace index
 * that is built asynchronously, so the FIRST file a suite opens can be typed before the index knows
 * about it — and when that happens the row never arrives at all, however long the wait. Reopening
 * the picker re-runs the search against an index that has since caught up. Measured on the Linux CI
 * runner, where `notes.py` (the first file this suite opens) timed out at 10s while every later
 * file resolved instantly.
 */
const open = async (file: string): Promise<void> => {
  const win = app().window;
  const row = win
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: file })
    .first();

  for (let attempt = 0; attempt < 3; attempt++) {
    await win.locator(".editor-group-container").first().click();
    await win.keyboard.press("ControlOrMeta+P");
    await win.keyboard.type(file);
    try {
      // `attached`, and clicked rather than Entered: the row reports `focused` while Playwright
      // still judges it unactionable, and a bare Enter races the picker's filtering.
      await row.waitFor({ state: "attached", timeout: 5000 });
      await row.click({ force: true });
      await win
        .locator(".view-line")
        .filter({ hasText: STRING_TEXT })
        .first()
        .waitFor({ timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      // Dismiss the picker before retrying, or the next Ctrl+P types into the open one.
      await win.keyboard.press("Escape");
    }
  }
};

/**
 * How many decorations OF OURS are on the first line containing `text`.
 *
 * Counted by the class VS Code stamps on a decorated range rather than by colour: a string literal
 * already carries several of the theme's own token colours, so counting colours reported
 * "coloured" for lines we had never touched.
 */
const decoratedSpans = async (text: string): Promise<number> => {
  const line = app()
    .window.locator(".view-line")
    .filter({ hasText: text })
    .first();
  await line.waitFor();
  return line.evaluate(
    (el) => el.querySelectorAll('[class*="TextEditorDecorationType"]').length
  );
};

for (const { file, comment } of LANGUAGES) {
  test(`${file}: the comment is coloured, the string literal is not`, async () => {
    await open(file);

    // The comment segments into ten morphemes, so this is a real colouring rather than one span.
    //
    // Generous, because the first file in this suite pays the tokenizer's 12MB dictionary load and
    // the grammar's WASM load, both lazy and both one-off. Measured as enough headroom for a cold
    // Linux CI runner, where the tighter 20s bound returned 0.
    await expect
      .poll(async () => decoratedSpans(comment), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(8);

    // The boundary. Asserted after the poll above, so a pass has demonstrably run on this file and
    // zero here means "decided against this line" rather than "nothing has happened yet".
    expect(await decoratedSpans(STRING_TEXT)).toBe(0);
  });
}

test("notes.py: a docstring is coloured, since it is prose the grammar calls a string", async () => {
  // WHY: the one place the `comment` scope prefix is not enough. TextMate scopes a docstring as
  // `string.quoted.docstring.multi.python` because it IS syntactically a string — but it is a
  // docstring precisely because of where it sits, which the grammar has already determined. An
  // ordinary Python string stays `string.quoted.single` and is still excluded, which the
  // string-literal assertion above holds.
  await open("notes.py");
  await expect
    .poll(async () => decoratedSpans("在庫を確認します。足りなければ"), {
      timeout: 20_000
    })
    .toBeGreaterThanOrEqual(4);
});
