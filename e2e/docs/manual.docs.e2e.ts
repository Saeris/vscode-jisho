/**
 * The README's screenshots.
 *
 * Each scenario ASSERTS the state it is about before capturing it. That is deliberate: a screenshot
 * of a broken state is worse than no screenshot, and the assertions are what make this script tell
 * you when the documentation has gone stale rather than silently illustrating a bug.
 *
 * Serial, and sharing one VS Code, for the same reason the rest of the suite is: each launch is
 * heavy. Scenarios must therefore leave the panel where they found it, or reset at their start.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVSCode, type Launched } from "../launch";
import {
  fillSearch,
  hoverEditorWord,
  jishoFrame,
  openJishoSidebar,
  returnToSearch
} from "../webview";
import { assertFullDictionary, captureBothThemes, sidebar } from "./capture";

/**
 * Open one of the fixture files by name, through the quick-open picker.
 *
 * Waits for the picker's row and CLICKS it rather than pressing Enter. Enter raced the filtering:
 * the row was on screen (confirmed in a failure screenshot) but the keystroke landed before the
 * list had settled on it, so nothing opened.
 */
const openFixture = async (win: Page, name: string): Promise<void> => {
  // Focus the editor group first: quick-open keystrokes die when focus sits inside a webview iframe,
  // which it does after any panel interaction.
  await win.locator(".editor-group-container").first().click();
  await win.keyboard.press("ControlOrMeta+P");
  await win.keyboard.type(name);
  const row = win.locator(".quick-input-list .monaco-list-row").filter({
    hasText: name
  });
  await row.first().click();
  // The file's own text, not just any line: another editor may already be open behind the picker.
  await expect(
    win.locator(".view-line").filter({ hasText: /\S/ }).first()
  ).toBeVisible();
};

/** Run a command through the palette, the same way. */
const runCommand = async (win: Page, title: string): Promise<void> => {
  await win.locator(".editor-group-container").first().click();
  await win.keyboard.press("ControlOrMeta+Shift+P");
  await win.keyboard.type(title);
  await win
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: title })
    .first()
    .click();
};

/** The editor area alone, for scenarios whose subject is the text rather than the panel. */
const editorRegion = (win: Page): Locator =>
  win.locator(".editor-group-container").first();

test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;

/** The fixture files, copied into the throwaway workspace so the editor has something to open. */
const FIXTURES = ["grammar-notes.md", "checkout.ts", "reading-notes.md"];

test.beforeAll(async () => {
  vscode = await launchVSCode({
    // A wider sidebar than the default: the manual's screenshots are the panel, and the default
    // width crops the word page's tag row onto three lines.
    "workbench.sideBar.location": "left"
  });
  await openJishoSidebar(vscode.window);

  // The workspace is a fresh temp dir, so the fixtures have to be written into it.
  for (const name of FIXTURES) {
    writeFileSync(
      join(vscode.workspaceDir, name),
      readFileSync(
        join(process.cwd(), "e2e", "docs", "fixtures", name),
        "utf8"
      ),
      "utf8"
    );
  }
});

test.afterAll(async () => {
  await vscode?.close();
});

test("guard: the docs run is against the full dictionary", async () => {
  // WHY: the common build is a ~22,000-word subset and the difference SHOWS in the pictures —
  // #computing holds 220 words there against 10,712 in the full build, and slang like きもい does
  // not exist at all. A browse list is counts-in-a-list, so a common-build capture would
  // misrepresent the product on the most-read page there is. Fail here rather than ship that.
  const frame = await jishoFrame(vscode!.window);
  await frame.getByRole("button", { name: /about/i }).click();
  await assertFullDictionary(frame);
  await frame.getByRole("button", { name: /back/i }).click();
});

test("capture: searching a word", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "search-results", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "食べる");
    // Assert the ranking the README claims: 食べる leads, not a rarer eat-verb.
    await expect(frame.getByRole("option").first()).toContainText("食べる");
    return sidebar(win);
  });
});

test("capture: a sentence, broken down", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "sentence-breakdown", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "毎日日本語を勉強します");
    // The breakdown bar is the subject. `role="radio"`, not `button`: it is a single-selection
    // ToggleButtonGroup, which React Aria renders as a radio group.
    await expect(
      frame.getByRole("radio", { name: /Filter results to 日本語/ })
    ).toBeVisible();
    await expect(frame.getByText("Partial matches")).toBeVisible();
    return sidebar(win);
  });
});

test("capture: the word page", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "word-page", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "食べる");
    await frame.getByRole("option").first().click();
    // The page's anatomy: an Info section means the entry hydrated rather than half-rendered.
    await expect(frame.getByRole("heading", { name: "Info" })).toBeVisible();
    return sidebar(win);
  });
});

test("capture: the conjugation table", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "conjugations", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "食べる");
    await frame.getByRole("option").first().click();
    const heading = frame.getByRole("heading", { name: /conjugation/i });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
    return sidebar(win);
  });
});

test("capture: stroke order", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "stroke-order", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "水");
    await frame
      .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
      .first()
      .click();
    await frame.getByRole("button", { name: /stroke order/i }).click();
    // The stroke count proves the drawing loaded, not just the page shell.
    await expect(frame.getByText(/\d+ strokes/)).toBeVisible();
    return sidebar(win);
  });
});

test("capture: the kana chart", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "kana-chart", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await frame
      .getByRole("tablist", { name: "Sections" })
      .getByRole("tab", { name: "Kana" })
      .click();
    await expect(
      frame
        .getByRole("listbox", { name: "Gojūon chart" })
        .getByRole("option", { name: "し shi" })
    ).toBeVisible();
    return sidebar(win);
  });
});

test("capture: browsing by category", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "browse-vocab", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await frame
      .getByRole("tablist", { name: "Sections" })
      .getByRole("tab", { name: "Vocab" })
      .click();
    await expect(
      frame.getByRole("button", { name: /Browse JLPT level/i })
    ).toBeVisible();
    return sidebar(win);
  });
});

/**
 * UNFINISHED — the editor hover capture.
 *
 * WHY it is wanted: hovering Japanese in a codebase is the extension's home turf, and the one thing
 * a screenshot shows that prose cannot — a definition arriving without leaving the file.
 *
 * WHY it is skipped: driving VS Code's hover from Playwright is the flakiest thing in this harness,
 * and it resisted several rounds. What was established along the way, so the next attempt does not
 * repeat it:
 *
 *  - Inside a STRING literal, TypeScript's language service owns the position and wins the dwell —
 *    the card said "(property) outOfStock: …" rather than showing the dictionary entry.
 *  - Monaco VIRTUALISES lines: an off-screen one measures 0×0 at (0,0), so the pointer goes to the
 *    window's corner, and `scrollIntoViewIfNeeded` fails with "Element is not attached to the DOM".
 *    Move the cursor (Go to Line) instead of scrolling a locator.
 *  - `hoverEditorWord` indexes characters into the line's FIRST text span, so leading indentation
 *    and syntax-highlighting splits both shift every offset. The fixture now carries an unindented
 *    top-level comment for this reason.
 *  - The card renders its shell before the provider resolves, so a capture can catch "(loading...)".
 *    Assert on the content, not just the card.
 *
 * Even with all of that, the dwell does not reliably produce a card here while the sidebar is open;
 * `smoke.e2e.ts` drives the same helper successfully against an UNTITLED editor, which is the next
 * thing to try. Until it is solved the README uses the panel captures, which all work.
 */
test.skip("capture: a hover in a source file", async () => {
  const win = vscode!.window;
  await captureBothThemes(
    vscode!,
    "editor-hover",
    async () => {
      await openFixture(win, "checkout.ts");
      // The fixture carries an UNINDENTED top-level `//` comment for exactly this capture, and the
      // choice is load-bearing twice over. Measured: hovering Japanese inside a STRING literal got
      // TypeScript's own hover instead — "(property) outOfStock: ..." — because the language
      // service owns that position and wins the dwell. And `hoverEditorWord` indexes characters
      // into the line's first text span, so any leading indentation shifts every offset.
      //
      // Near the top of the file, so nothing needs scrolling: Monaco virtualises its lines, and an
      // off-screen one measures 0x0 at (0,0), which puts the pointer in the window's corner.
      const line = win
        .locator(".view-line", { hasText: "在庫を確認してから決済に進みます" })
        .first();
      await expect(line).toBeVisible();
      // Index 3 skips the "// " prefix; the word is the first thing after it.
      const hover = await hoverEditorWord(
        win,
        "在庫を確認してから決済に進みます",
        3,
        18,
        "在庫"
      );
      // Wait for the ENTRY, not merely the card. VS Code renders the hover shell immediately and
      // fills it in when the provider resolves, so an earlier capture caught "(loading...)" — a
      // picture of the extension appearing not to work.
      await expect(hover).not.toContainText("loading");
      return hover;
      // `keepPointer`: the hover card IS the subject here, and parking the pointer dismisses it — the
      // card then detaches and the screenshot fails on a stale element.
    },
    { keepPointer: true }
  );
});

test("capture: furigana added to a study note", async () => {
  // WHY: "Add Furigana" is hard to describe and obvious in a picture. The fixture is a grammar
  // guide, which is where someone would actually reach for it.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "add-furigana", async () => {
    await openFixture(win, "reading-notes.md");
    await win.keyboard.press("ControlOrMeta+A");
    await runCommand(win, "Jisho: Add Furigana");
    // The ruby markup is the result. Assert it landed before shooting the editor.
    await expect(
      win.locator(".view-line").filter({ hasText: "|" }).first()
    ).toBeVisible();
    return editorRegion(win);
  });
});
