import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import {
  fillSearch,
  jishoFrame,
  openJishoSidebar,
  searchText
} from "./webview";

/**
 * The breakdown bar as a FILTER over the current sentence (#16).
 *
 * E2E rather than component-level on purpose: the bug this guards against is a feedback loop
 * between the navigation machine, the search view and the contenteditable search box, and only a
 * real editor wires all three together. A component test renders the field with a fixed prop and
 * cannot see a machine round-trip clobbering the caret mid-keystroke.
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;

test.beforeAll(async () => {
  vscode = await launchVSCode({});
  await openJishoSidebar(vscode.window);
});
test.afterAll(async () => {
  await vscode?.close();
});

const SENTENCE = "今日は寒いですよね";

test("typing a sentence leaves the query exactly as typed", async () => {
  // WHY (user report): the caret jumped to the start of the box while typing, so characters landed
  // in the wrong order and the query was mangled. Asserting the FULL string after per-character
  // typing is what catches a caret that does not stay where the user put it.
  const win = vscode!.window;
  const frame = await jishoFrame(win);

  await fillSearch(frame, SENTENCE);
  expect(await searchText(frame)).toBe(SENTENCE);
});

test("the breakdown bar filters in place instead of replacing the query", async () => {
  // WHY (#16): the whole point is that the sentence SURVIVES the tap. The old behaviour overwrote
  // the box with the chip's lemma, which is what made chip-to-chip movement impossible.
  const win = vscode!.window;
  const frame = await jishoFrame(win);

  await fillSearch(frame, SENTENCE);
  const bar = frame.getByRole("radiogroup", { name: "Filter results by word" });
  await expect(bar).toBeVisible();

  // 今日 is the first content chip.
  const chip = bar.getByRole("radio").first();
  await chip.click();

  // The query is untouched, and the chip reads as selected.
  expect(await searchText(frame)).toBe(SENTENCE);
  await expect(chip).toHaveAttribute("aria-checked", "true");

  // Tapping it again clears the filter rather than stranding the user.
  await chip.click();
  await expect(chip).toHaveAttribute("aria-checked", "false");
  expect(await searchText(frame)).toBe(SENTENCE);
});

test("pasting a sentence lands it once, with the caret after it", async () => {
  // WHY (user report): the bug was first hit by PASTING a sentence, not typing one. Paste is a
  // different input path — one `insertFromPaste` carrying the whole string, rather than a
  // per-character sequence — so a field that handles typing correctly can still mishandle it.
  const win = vscode!.window;
  const frame = await jishoFrame(win);
  const paste = "ある日の暮方の事である。";

  // Copy from a real editor rather than writing the clipboard directly — the webview is not
  // allowed to call `clipboard.writeText`, and this is how the sentence got there in the report.
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  await win.keyboard.type(paste);
  await win.keyboard.press("ControlOrMeta+a");
  await win.keyboard.press("ControlOrMeta+c");

  await fillSearch(frame, "");
  const box = frame.getByRole("searchbox");
  await box.click();
  await box.press("ControlOrMeta+v");

  expect(await searchText(frame)).toBe(paste);

  // And the caret is after it: typing appends rather than landing at the start.
  await box.pressSequentially("か");
  expect(await searchText(frame)).toBe(`${paste}か`);
});

test("a sentence's results are labelled as partial matches", async () => {
  // WHY (Shirabe reference): every result for a sentence is a fragment of what was typed, and an
  // unlabelled list says nothing about that. Verified against the real dictionary rather than a
  // mock, because the section only appears when the HOST decides the query is multi-word.
  const win = vscode!.window;
  const frame = await jishoFrame(win);

  await fillSearch(frame, "毎日日本語を勉強します");
  await expect(frame.getByText("Partial matches")).toBeVisible();
  // No entry exists for the whole sentence, so nothing is featured above it.
  await expect(frame.getByRole("listbox", { name: "Full match" })).toHaveCount(
    0
  );

  await win.screenshot({ path: "test-results/shots/23-partial-matches.png" });
});

test("a set phrase the tokenizer does not split is a plain ranked list", async () => {
  // WHY: 申し訳ございません is a dictionary entry AND, in Shirabe, a sentence broken into
  // もうしわけ/ござい/ません. IPADIC disagrees — it tokenizes the whole polite formula as ONE noun, so
  // no breakdown exists to label and the query is not "multi-word" by our definition.
  //
  // The right outcome is therefore the plain ranked list, with the exact entry on top: featuring it
  // above a "Partial matches" header would promise a fragment list we have nothing to put in. This
  // pins that, so a future tokenizer change that DOES split it shows up here as a failure to
  // re-decide rather than as a silently different UI.
  const win = vscode!.window;
  const frame = await jishoFrame(win);

  await fillSearch(frame, "申し訳ございません");
  await expect(frame.getByRole("option").first()).toContainText(
    "申し訳ございません"
  );
  await expect(frame.getByText("Partial matches")).toHaveCount(0);
  await expect(frame.getByRole("listbox", { name: "Full match" })).toHaveCount(
    0
  );

  await win.screenshot({ path: "test-results/shots/24-set-phrase.png" });
});

test("a plain word lookup is not labelled", async () => {
  // WHY: 食べる already leads by ranking; adding a header to every ordinary search would be noise.
  const frame = await jishoFrame(vscode!.window);
  await fillSearch(frame, "食べる");
  await expect(frame.getByRole("option").first()).toBeVisible();
  await expect(frame.getByText("Partial matches")).toHaveCount(0);
});

test("continuing to type after a filter keeps the caret at the end", async () => {
  // WHY: the reported failure showed up as Enter inserting a newline BEFORE the text, i.e. the
  // caret had silently moved to offset 0. Typing more characters and checking they land at the end
  // is the direct assertion of that.
  const win = vscode!.window;
  const frame = await jishoFrame(win);

  await fillSearch(frame, "寒い");
  const box = frame.getByRole("searchbox");
  await box.click();
  await box.pressSequentially("です");
  expect(await searchText(frame)).toBe("寒いです");
});
