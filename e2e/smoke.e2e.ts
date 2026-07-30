import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  hoverEditorWord,
  jishoFrame,
  openJishoSidebar,
  returnToSearch
} from "./webview";

// The foundational end-to-end path: real VS Code launches, our extension activates, the sidebar
// webview renders, and a search returns real DB-backed results. If this passes, the harness works
// and every richer E2E builds on it.
test.describe.configure({ mode: "serial" });

test("opens the Jisho sidebar and renders the search UI", async ({
  vscode
}) => {
  await openJishoSidebar(vscode.window);
  const frame = await jishoFrame(vscode.window);
  // jishoFrame only waits for the app root (the search view can be hidden behind a detail view),
  // so assert the search UI explicitly here.
  await expect(frame.getByRole("searchbox")).toBeVisible();
  // Capture the whole workbench: proves no first-run/sign-in modal is overlaying the UI, and is the
  // entry point for the visual-iteration loop (look at real pixels, refine, re-shoot).
  await vscode.window.screenshot({ path: "test-results/shots/01-sidebar.png" });
});

test("searching a word returns real dictionary results", async ({ vscode }) => {
  const frame = await jishoFrame(vscode.window);
  await frame.getByRole("searchbox").fill("食べる");
  // Results are DB-backed; 食べる must appear as an option in the list.
  await expect(frame.getByText("食べる").first()).toBeVisible();
  await expect(frame.getByText("to eat").first()).toBeVisible();
});

test("tapping a result opens its word detail", async ({ vscode }) => {
  const frame = await jishoFrame(vscode.window);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();

  // NOTE: the search view stays MOUNTED (inside <Activity>) when a detail view is pushed, so a bare
  // getByText() also matches the now-hidden search results. Assert on visible elements only.
  // The Back control is the detail view's unambiguous marker.
  await expect(frame.getByRole("button", { name: /back/i })).toBeVisible();
  // The detail shows the reading and a resolved part-of-speech tag ("Ichidan verb").
  await expect(
    frame.getByText("たべる").locator("visible=true").first()
  ).toBeVisible();
  await expect(
    frame
      .getByText(/ichidan/i)
      .locator("visible=true")
      .first()
  ).toBeVisible();
});

test("tapping a word in an example opens that word's detail (F1-links)", async ({
  vscode
}) => {
  // WHY: the whole point of build-time linkification — a word in an example sentence is tappable and
  // opens ITS entry (open-by-id). Proves the build markup → parser → nav chain end to end.
  await openJishoSidebar(vscode.window);
  const frame = await jishoFrame(vscode.window);
  await returnToSearch(frame);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame.getByRole("button", { name: "More examples" }).click();
  await frame.getByRole("heading", { name: /Examples for/ }).waitFor();
  // Tap the first linked word in the pool (any example word is a button). It opens a word detail,
  // so the examples heading is gone and a word page's markers (the reading, the "More examples" link)
  // appear. (Both "Back" and "Home" now show — we're 3 deep: search → word → examples → word — so
  // match Back exactly rather than /back/i, which also hits "Back to search".)
  await frame.locator('[lang="ja"] button').first().click();
  await expect(
    frame.getByRole("heading", { name: /Examples for/ })
  ).toBeHidden();
  await expect(
    frame.getByRole("button", { name: "Back", exact: true })
  ).toBeVisible();
  // A word detail (not another examples page): its own "More examples" link is present.
  await expect(
    frame.getByRole("button", { name: "More examples" })
  ).toBeVisible();
});

// `ControlOrMeta`, never `Control`: Playwright maps it to Cmd on macOS and Ctrl elsewhere. Hardcoded
// `Control+` presses meant this suite could not pass on a Mac at all — Ctrl+N opens no editor there,
// so the first such test timed out on a locator waiting for an editor that was never created, and
// serial mode then skipped everything after it.
test("editor command: Look Up Selection drives the sidebar search", async ({
  vscode
}) => {
  const win = vscode.window;
  // A real editor with Japanese text, selected. Focus sits in the editor, so the palette works
  // (inside the webview, F1 goes to the extension's own search box instead).
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  await win.keyboard.type("食べました");
  await win.keyboard.press("ControlOrMeta+a");

  await win.keyboard.press("F1");
  await win.locator(".quick-input-widget").waitFor();
  await win.keyboard.type("Jisho: Look Up Selection");
  await win
    .locator(".quick-input-list .monaco-list-row", {
      hasText: "Look Up Selection"
    })
    .first()
    .waitFor();
  await win.keyboard.press("Enter");

  // The command reveals the sidebar and pushes the query through: the search box carries the
  // selection and deinflected results (食べました → 食べる) arrive from the real DB.
  const frame = await jishoFrame(win);
  await expect(frame.getByRole("searchbox")).toHaveValue("食べました");
  await expect(frame.getByText("to eat").first()).toBeVisible();
});

test("hovering Japanese text shows a dictionary hover", async ({ vscode }) => {
  // Self-contained: its own untitled editor, so the test runs standalone (and under --grep).
  const win = vscode.window;
  // The hover provider only exists once the extension ACTIVATES, and activation rides on the
  // sidebar view — in a standalone run nothing else has opened it (found via a failure screenshot
  // showing the Explorer and a dead hover).
  await openJishoSidebar(win);
  // Focus the editor area first — keystrokes die if focus sits in a webview or is unset at
  // launch (the F1-in-webview lesson again).
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  // The hardest case in one line: mirrordown ruby markup AND a complex conjugation. The braces
  // must not split the run, the cursor lands on "{" and maps into the base, the auxiliaries
  // (たくなかった) group onto the verb, and the lemma 食べる resolves the entry.
  await win.keyboard.type("{食|た}べたくなかった");
  // {食|た}べたくなかった is 12 chars; hover the べ at index 4 (inside the word, past the ruby markup).
  // Hover the 食べ stem (index 0-1), not an auxiliary — so the DEFINITION shows, not a grammar note.
  const hover = await hoverEditorWord(win, "べたくなかった", 0, 12, "to eat");
  await expect(hover).toContainText("食べる");
  // The conjugation chain of the detected form. Each auxiliary is now an <ins title="…"> tag, so
  // the glosses ("want to", "past") live in TOOLTIPS, not visible text — assert on the title attr.
  await expect(hover).toContainText("食べたくなかった");
  await expect(hover.locator('ins[title="want to"]').first()).toBeVisible();
  await expect(hover.locator('ins[title="past"]').first()).toBeVisible();
  await expect(hover).toContainText("Open in Jisho");
  // The rich layout renders against real DB data: the headword is a ruby heading, and POS is a
  // <kbd> pill (一段動詞 for 食べる). Asserting the ELEMENTS confirms the HTML survived the sanitizer
  // end-to-end, which only a live hover can — the unit tests check the markup string, not the DOM.
  await expect(hover.locator("h1 ruby").first()).toBeVisible();
  await expect(hover.locator("kbd").first()).toBeVisible();
  // Reference shot for the hover-design iteration (BACKLOG #33: user wants to refine it visually).
  await vscode.window.screenshot({ path: "test-results/shots/02-hover.png" });
});

test("hovering する resolves the verb, not a homophone (POS-aware accuracy fix)", async ({
  vscode
}) => {
  // WHY: the reported false-positive. Hovering the し of してください used to resolve to a same-reading
  // homophone (擦る "to rub" ranked over 為る "to do", or the noun 死) because the hover searched the
  // lemma STRING. The POS-aware resolveByLemma uses the tokenizer's (lemma=する, pos=verb), so the
  // hover must show "to do" and NOT "to rub" / "death". Only a live hover exercises the real path.
  const win = vscode.window;
  await openJishoSidebar(win);
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  // する must stand alone: in 勉強してXX the tokenizer folds 勉強+し into one サ変 verb (勉強する), so
  // it wouldn't isolate する. In 仕事をして…, し is its own segment with lemma する.
  await win.keyboard.type("仕事をしてください");
  // 仕事をしてください: hover the し (index 3) — the tokenizer gives it lemma する.
  const hover = await hoverEditorWord(win, "仕事をしてください", 3, 8, "to do");
  await expect(hover).toContainText("to do");
  await expect(hover).not.toContainText("to rub");
  await expect(hover).not.toContainText("death");
});

test("hovering a particle explains its grammar", async ({ vscode }) => {
  // を here sits INSIDE a longer run (本を読みます is one continuous Japanese sequence), so it is
  // reached by tokenizing and finding a particle segment — not by the standalone single-character
  // path. That distinction cost a debugging round: the first version of this test assumed the
  // particle would be its own run, and the hover never fired. Only a real editor exercises the
  // real segmentation, which is why this is an E2E rather than a unit test.
  const win = vscode.window;
  await openJishoSidebar(win);
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  const editor = win.locator(".editor-group-container .monaco-editor").first();
  await editor.waitFor();
  // Click INTO the new editor before typing. Opening the sidebar leaves focus in the webview, and
  // Ctrl+N alone does not reliably pull it back — the first run of this test typed the whole line
  // into the sidebar's search box instead (visible in the failure screenshot), so the editor stayed
  // empty and the locator below waited on text that was never there.
  await editor.click();
  await win.keyboard.type("本を読みます");

  // Hover を — the second of the six characters (本 を 読 み ま す).
  const hover = await hoverEditorWord(
    win,
    "本を読みます",
    1,
    6,
    "Direct object"
  );
  // The example arrives as two lines — the sentence as written, then its kana reading — with the
  // stored ruby markup resolved away.
  //
  // Not <ruby> furigana, though VS Code does render it: a probe measured <rt> at 7px against a 14px
  // body and confirmed the sanitizer strips `style`, so an extension cannot enlarge it. Legible in
  // principle, unreadable in practice. The SIDEBAR tooltip uses real furigana, where our own
  // stylesheet applies.
  await expect(hover).toContainText("本 を 読みます");
  await expect(hover).toContainText("ほん を よみます");
  await expect(hover).not.toContainText("{");
  await vscode.window.screenshot({
    path: "test-results/shots/02b-hover-particle.png"
  });
});

test("hovering an auxiliary shows its grammar note alone, not the word definition", async ({
  vscode
}) => {
  // The double-match fix: the cursor sits on one thing and the hover explains THAT. On the たい of
  // 食べたい, the hover is the 〜たい grammar note — NOT the 食べる definition stacked underneath it.
  const win = vscode.window;
  await openJishoSidebar(win);
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  const editor = win.locator(".editor-group-container .monaco-editor").first();
  await editor.waitFor();
  await editor.click();
  await win.keyboard.type("食べたい");

  // Hover the た of たい — index 2 of 食べたい (食=0 べ=1 た=2 い=3), the auxiliary.
  const hover = await hoverEditorWord(win, "食べたい", 2, 4, "Want to");
  // The grammar note is present…
  await expect(hover).toContainText("Want to");
  // …and the word definition is NOT: no "to eat" gloss, no POS pill, no Open-in-Jisho link.
  await expect(hover).not.toContainText("to eat");
  await expect(hover).not.toContainText("Open in Jisho");
  await expect(hover.locator("kbd")).toHaveCount(0);
  await vscode.window.screenshot({
    path: "test-results/shots/02c-hover-auxiliary.png"
  });
});

/** Run a Jisho command through the palette. Focus must already be outside the webview. */
const runCommand = async (win: Page, name: string): Promise<void> => {
  await win.keyboard.press("F1");
  await win.locator(".quick-input-widget").waitFor();
  await win.keyboard.type(`Jisho: ${name}`);
  await win
    .locator(".quick-input-list .monaco-list-row", { hasText: name })
    .first()
    .waitFor();
  await win.keyboard.press("Enter");
};

/** A fresh untitled editor holding `text`, with focus in it and everything selected. */
const editorWith = async (win: Page, text: string): Promise<void> => {
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  await win.keyboard.type(text);
  await win.keyboard.press("ControlOrMeta+a");
};

test("editor commands: word spacing round-trips through the palette", async ({
  vscode
}) => {
  const win = vscode.window;
  await editorWith(win, "写真を見せました");

  await runCommand(win, "Add Word Spacing");
  await expect(
    win.locator(".view-line", { hasText: "写真 を 見せました" }).first()
  ).toBeVisible({ timeout: 15_000 });

  await runCommand(win, "Remove Word Spacing");
  await expect(
    win.locator(".view-line", { hasText: /^写真を見せました$/ }).first()
  ).toBeVisible({ timeout: 15_000 });
});

test("editor commands: furigana round-trips through the palette", async ({
  vscode
}) => {
  const win = vscode.window;
  await editorWith(win, "写真を見せました");

  await runCommand(win, "Add Furigana");
  // Only the kanji get annotated — okurigana stays outside the braces, which is the whole point
  // of aligning readings rather than wrapping whole words.
  await expect(
    win
      .locator(".view-line", { hasText: "{写真|しゃしん}を{見|み}せました" })
      .first()
  ).toBeVisible({ timeout: 15_000 });

  await runCommand(win, "Remove Furigana");
  await expect(
    win.locator(".view-line", { hasText: /^写真を見せました$/ }).first()
  ).toBeVisible({ timeout: 15_000 });
});

test("copy as: furigana markdown reaches the system clipboard", async ({
  vscode
}) => {
  const win = vscode.window;
  // Self-contained: the sidebar is what activates the extension, and a --grep run may not have
  // opened it yet.
  await openJishoSidebar(win);
  const frame = await jishoFrame(win);
  // Reset to search, then open a word with kanji so the ruby variants are offered.
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
  await frame.getByRole("menuitem", { name: /Furigana \(Markdown\)/ }).click();

  // Read the clipboard by PASTING: clipboard reads from Playwright are unreliable, pastes aren't.
  await editorWith(win, "");
  await win.keyboard.press("ControlOrMeta+v");
  await expect(
    win.locator(".view-line", { hasText: "{食|た}べる" }).first()
  ).toBeVisible({ timeout: 15_000 });
});
