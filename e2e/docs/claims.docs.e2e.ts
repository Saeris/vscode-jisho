/**
 * The README's CLAIMS, as assertions.
 *
 * The screenshot harness next door asserts a flow before capturing it, so a broken flow fails
 * rather than producing a picture of a broken state. That covers the images. It does not cover the
 * 1,900 words of prose around them: a sentence describing behaviour the extension no longer has
 * passes every other test in this repository.
 *
 * Each test here is named for the claim it guards and quotes the sentence, so a failure points at
 * the text to fix rather than at a mechanism. When the product legitimately changes, the fix is to
 * EDIT THE PROSE and update the test in the same commit — that is the whole point of the file.
 *
 * Runs with `vp run docs:shots`, excluded from the default suite for the same reason the captures
 * are (see docs/specs/19-documentation-drift-tests.md, which also records the claims that are NOT
 * checkable, so this suite is not mistaken for total coverage).
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVSCode, type Launched } from "../launch";
import {
  fillSearch,
  hoverEditorWord,
  jishoFrame,
  openJishoSidebar,
  returnToSearch
} from "../webview";
import { assertFullDictionary } from "./capture";

test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;
let jisho: FrameLocator;

/** A Markdown and a TypeScript file holding the same sentence, for the hover-scope claim. */
const SENTENCE = "毎日日本語を勉強します。";

test.beforeAll(async () => {
  vscode = await launchVSCode({ "workbench.sideBar.location": "left" });
  await openJishoSidebar(vscode.window);
  jisho = await jishoFrame(vscode.window);
  writeFileSync(
    join(vscode.workspaceDir, "notes.md"),
    `# メモ\n\n${SENTENCE}\n`,
    "utf8"
  );
  writeFileSync(
    join(vscode.workspaceDir, "code.ts"),
    `// ${SENTENCE}\nexport const x = 1;\n`,
    "utf8"
  );
});

test.afterAll(async () => {
  await vscode?.close();
});

/** The first result's text, after searching `query`. */
const firstResult = async (query: string): Promise<string> => {
  await returnToSearch(jisho);
  await fillSearch(jisho, query);
  const option = jisho.getByRole("option").first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  return (await option.textContent()) ?? "";
};

/** Open a workspace file through quick-open. */
const openFile = async (win: Page, name: string): Promise<void> => {
  await win.locator(".editor-group-container").first().click();
  await win.keyboard.press("ControlOrMeta+P");
  await win.keyboard.type(name);
  await win
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: name })
    .first()
    .click();
  await expect(
    win.locator(".view-line").filter({ hasText: /\S/ }).first()
  ).toBeVisible();
};

test("guard: the claims run against the full dictionary", async () => {
  // The README's counts and rankings describe the shipped dictionary. Asserting them against the
  // ~22,000-word common build would check a product nobody installs.
  await jisho.getByRole("button", { name: /about/i }).click();
  await assertFullDictionary(jisho);
  await jisho.getByRole("button", { name: /back/i }).click();
});

/* ── Searching ───────────────────────────────────────────────────────────── */

test("claim: all four kinds of input find the same word", async () => {
  // README: "The search field takes four kinds of input, and you do not have to tell it which you
  // are using." — followed by a table promising 図書館 / としょかん / toshokan / library.
  //
  // One assertion per row of that table, because the table is the claim: if romaji silently stopped
  // resolving, three rows would still pass and the listing would still promise four.
  for (const query of ["図書館", "としょかん", "toshokan", "library"]) {
    expect(await firstResult(query), `searching ${query}`).toContain("図書館");
  }
});

test("claim: conjugated input finds the dictionary form", async () => {
  // README: "Type a word as it appears in your text. Jisho works back to the dictionary form:
  // 食べました finds 食べる, 読まなかった finds 読む."
  //
  // Both examples, since the manual prints both.
  expect(await firstResult("食べました")).toContain("食べる");
  expect(await firstResult("読まなかった")).toContain("読む");
});

test("claim: the word you probably meant comes first", async () => {
  // README: "Results are ranked by relevance, so the word you probably meant comes first."
  //
  // 食べる is the test because the dictionary holds rarer eat-verbs (喰らう, 啖う) that a naive
  // match-tier ranking surfaces above it. This asserts the RANKING, not that a match exists.
  expect(await firstResult("食べる")).toContain("食べる");
});

test("claim: a sentence is broken into labelled words", async () => {
  // README: "Paste a sentence and Jisho breaks it into words, each labelled with its part of
  // speech. Select any one of them to search it on its own."
  await returnToSearch(jisho);
  await fillSearch(jisho, "毎日日本語を勉強します");
  // `role=radio`, not `button`: the breakdown bar is a single-select ToggleButtonGroup, which React
  // Aria renders as a radio group.
  const segments = jisho.getByRole("radio");
  await expect(segments.first()).toBeVisible({ timeout: 20_000 });
  // More than one, because a sentence that failed to tokenize yields exactly one segment — the
  // whole string — which is the failure this claim is about.
  expect(await segments.count()).toBeGreaterThan(2);
});

test("claim: a full match is separated from partial matches", async () => {
  // README: "The bar separates the sentence's full match from its partial matches, so a phrase that
  // is itself an entry does not get buried under its own components."
  await returnToSearch(jisho);
  await fillSearch(jisho, "毎日日本語を勉強します");
  await expect(jisho.getByText("Partial matches")).toBeVisible({
    timeout: 20_000
  });
});

test("claim: kanji appear in their own section", async () => {
  // README: "A search that matches a character lists it in its own Kanji section, below the words."
  await returnToSearch(jisho);
  await fillSearch(jisho, "食べる");
  const section = jisho.getByRole("listbox", { name: /kanji results/i });
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(section.getByRole("option").first()).toContainText("食");
});

/* ── Reading a word ──────────────────────────────────────────────────────── */

test("claim: every word in an example links to its own entry", async () => {
  // README: "Every sentence has furigana over its kanji, and every word in it is a link to its own
  // entry." — and in Get started, step 4: "Select any Japanese word in an example to jump to its
  // entry."
  //
  // The links are built at DATA BUILD time, as `[surface](pos:entseq)` markup baked into the
  // sentence. So this claim can break without any UI change at all — a build that stopped emitting
  // the markup would leave the sentences rendering perfectly as plain text, and the manual would go
  // on promising a tap target that is not there. Asserts the NAVIGATION, not that a link exists.
  await returnToSearch(jisho);
  await fillSearch(jisho, "食べる");
  await jisho.getByRole("option").first().click();
  await expect(jisho.getByRole("heading", { name: "Info" })).toBeVisible({
    timeout: 20_000
  });
  const exampleWord = jisho.getByRole("button", { name: /^Open .+/ }).first();
  await expect(exampleWord).toBeVisible();
  const target = (await exampleWord.getAttribute("aria-label")) ?? "";
  await exampleWord.click();
  // Landing on an entry means a headword and a Back control, and the entry has to be a DIFFERENT
  // one than we started on — a link that navigated nowhere would still show a word page.
  await expect(
    jisho.getByRole("button", { name: /back/i }).first()
  ).toBeVisible();
  expect(target).not.toContain("食べる");
});

/* ── Finding a character ─────────────────────────────────────────────────── */

test("claim: radicals that cannot extend the selection grey out", async () => {
  // README: "Radicals that cannot appear alongside your selection grey out as you go."
  //
  // Asserts the DISABLING, which is the claim — that some radical is present but unusable — rather
  // than that the picker rendered.
  await returnToSearch(jisho);
  await jisho
    .getByRole("button", { name: /look up kanji by radicals/i })
    .click();
  const eye = jisho.getByRole("button", { name: "目", exact: true });
  await expect(eye).toBeVisible({ timeout: 20_000 });
  await eye.click();
  await expect(
    jisho.getByRole("button", { disabled: true }).first()
  ).toBeVisible();
  await jisho.getByRole("button", { name: /back/i }).first().click();
});

test("claim: an unfinished drawing still returns candidates", async () => {
  // README: "Stroke order and stroke count do not matter, and you do not have to finish." plus
  // "Candidates update after every stroke."
  //
  // Two strokes of a character that needs six. If the recognizer ever required a complete drawing,
  // this is the sentence that would become false.
  await returnToSearch(jisho);
  await jisho.getByRole("button", { name: /draw a kanji to search/i }).click();
  const canvas = jisho.locator("svg").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the drawing canvas has no box");
  const win = vscode!.window;
  const stroke = async (
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): Promise<void> => {
    await win.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
    await win.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await win.mouse.move(
        box.x + box.width * (x1 + ((x2 - x1) * i) / 8),
        box.y + box.height * (y1 + ((y2 - y1) * i) / 8)
      );
    }
    await win.mouse.up();
  };
  await stroke(0.3, 0.35, 0.7, 0.35);
  await stroke(0.2, 0.62, 0.8, 0.62);
  // A candidate's accessible name is "<character>: <meaning>" now that the tiles carry meanings.
  await expect(
    jisho.getByRole("button", { name: /^[一-鿿](:|$)/u }).first()
  ).toBeVisible({ timeout: 30_000 });
  await jisho.getByRole("button", { name: /back/i }).first().click();
});

test("claim: selecting a kana opens stroke order rather than searching", async () => {
  // README: "Selecting a kana opens its stroke order, because these are single syllables rather
  // than words and there is nothing to look up."
  //
  // The claim is about what does NOT happen, so it asserts the destination: a stroke player, not a
  // result list.
  await returnToSearch(jisho);
  await jisho.getByRole("tab", { name: /kana/i }).click();
  await jisho.getByRole("option", { name: /^あ/ }).first().click();
  await expect(jisho.getByText(/stroke/i).first()).toBeVisible({
    timeout: 20_000
  });
});

/* ── In the editor ───────────────────────────────────────────────────────── */

test("claim: hovers work in Markdown", async () => {
  // README: "Point at a Japanese word to see what it means." (under "Working in the editor", which
  // states the feature applies to Markdown and plain-text files.)
  const win = vscode!.window;
  await openFile(win, "notes.md");
  const hover = await hoverEditorWord(win, SENTENCE, 0, 12, "毎日");
  await expect(hover).not.toContainText("loading");
});

test("claim: hovers do NOT work in code files", async () => {
  // README: "Hovers and part-of-speech coloring apply to Markdown and plain-text files only.
  // Japanese in a .ts, .py or .go file is not covered yet."
  //
  // This is the most valuable test in the file, and the reason the tier exists. It guards a stated
  // LIMITATION — the claim most likely to become quietly false, because implementing spec 18 would
  // make it wrong without touching anything the docs mention. When this fails, the extension gained
  // a feature and the manual is under-selling it.
  const win = vscode!.window;
  await openFile(win, "code.ts");
  const line = win.locator(".view-line", { hasText: SENTENCE }).first();
  await expect(line).toBeVisible();
  const span = line.locator("span").first();
  const box = await span.boundingBox();
  if (!box) throw new Error("could not measure the comment");
  // Point at 日本語, past the `// ` prefix.
  await win.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
  await win.waitForTimeout(1_500);
  // Jisho's card is identified by the link it always renders. Any OTHER hover (TypeScript's own)
  // is fine and expected — the claim is only that OURS does not appear.
  //
  // Asserted as NOT VISIBLE rather than absent, which is the difference between this passing and
  // this lying. Every editor keeps a `.monaco-hover-content` element and REUSES it, so the card
  // built for the previous test's Markdown hover is still in the DOM here, still carrying its old
  // text — `toHaveCount(0)` therefore failed against a card the screenshot proves was not on
  // screen. Visibility is the thing the claim is actually about.
  await expect(
    win.locator(".monaco-hover-content").filter({ hasText: "Open in Jisho" })
  ).toBeHidden();
});

test("claim: Add Furigana emits the documented markup", async () => {
  // README: "The markup is {漢字|かんじ}: the word, a pipe, then its reading."
  //
  // Asserts the SHAPE the manual prints, because that syntax is what the Mirrordown plugins the
  // manual recommends are documented to parse. A change to the delimiters would silently break the
  // integration the manual sends readers to.
  const win = vscode!.window;
  await openFile(win, "notes.md");
  await win.keyboard.press("ControlOrMeta+A");
  await win.locator(".editor-group-container").first().click();
  await win.keyboard.press("ControlOrMeta+Shift+P");
  await win.keyboard.type("Jisho: Add Furigana");
  await win
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: "Add Furigana" })
    .first()
    .click();
  await expect(
    win.locator(".view-line").filter({ hasText: "{毎日|まいにち}" }).first()
  ).toBeVisible({ timeout: 20_000 });
  // Leave the buffer as it was found: this suite is serial and shares one window.
  await win.keyboard.press("ControlOrMeta+Z");
});
