/**
 * The README's screenshots.
 *
 * Each scenario ASSERTS the state it is about before capturing it. That is deliberate: a screenshot
 * of a broken state is worse than no screenshot, and the assertions are what make this script tell
 * you when the documentation has gone stale rather than silently illustrating a bug.
 *
 * Serial, and sharing one VS Code, for the same reason the rest of the suite is: each launch is
 * heavy. Scenarios must therefore leave the panel where they found it, or reset at their start.
 *
 * Captures come in two shapes. A WHOLE-PANEL shot shows a screen in context; a CROP shows one
 * control or section when the prose is pointing at a detail. Reach for the crop by default — a full
 * panel to illustrate the copy menu buries it in everything else on the page.
 */
import { expect, test, type Page } from "@playwright/test";
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
import {
  assertFullDictionary,
  captureBothThemes,
  cropAround,
  scrollToTop,
  sidebar,
  workbenchRegion
} from "./capture";

/**
 * Open one of the fixture files by name, through the quick-open picker.
 *
 * Waits for the picker's row and CLICKS it rather than pressing Enter. Enter raced the filtering:
 * the row was on screen (confirmed in a failure screenshot) but the keystroke landed before the
 * list had settled on it, so nothing opened.
 *
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

test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;

/** The fixture files, copied into the throwaway workspace so the editor has something to open. */
const FIXTURES = ["grammar-notes.md", "checkout.ts", "reading-notes.md"];

test.beforeAll(async () => {
  vscode = await launchVSCode({
    "workbench.sideBar.location": "left",
    // Part-of-speech colouring is OFF by default, but it is a headline feature and the editor
    // captures are where it shows. Turning it on here documents what it looks like rather than
    // what the defaults are.
    "vscode-jisho.highlighting.enabled": true
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

/* ── Search ──────────────────────────────────────────────────────────────── */

test("capture: the search box and its tools", async () => {
  // A CROP, not the panel: the prose here is about the field and the four buttons beside it
  // (radicals, handwriting, settings, about), which are a strip a whole-panel shot would bury.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "search-toolbar", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "");
    const box = frame.getByRole("searchbox");
    const about = frame.getByRole("button", { name: /about this extension/i });
    await expect(box).toBeVisible();
    await expect(about).toBeVisible();
    return cropAround(win, [box, about]);
  });
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

test("capture: finding a kanji by its radicals", async () => {
  // WHY: the payoff is the RESULT — pick a couple of components and the matching characters appear.
  // A shot of the empty picker would show a grid of radicals and no reason to care.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "radical-picker", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await frame
      .getByRole("button", { name: /look up kanji by radicals/i })
      .click();
    // 目 (eye), verified present in the picker's own list — the water radical is there under a
    // different variant, and a character that "should" be a radical is not necessarily the one
    // KRADFILE uses. Two selections keep the result set small and legible.
    await frame.getByRole("button", { name: "目", exact: true }).click();
    await frame.getByRole("button", { name: "月", exact: true }).click();
    // Results are what the capture is for, so wait for one before shooting.
    await expect(
      frame.getByRole("button", { name: /^Open .+:/ }).first()
    ).toBeVisible();
    return sidebar(win);
  });
});

test("capture: drawing a kanji to find it", async () => {
  // WHY: handwriting is the hardest feature to describe and the most obvious in a picture. The
  // strokes are synthesised as pointer events — the same path a real pen takes — so the candidates
  // shown are the recognizer's genuine output rather than a mock.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "handwriting", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await frame
      .getByRole("button", { name: /draw a kanji to search/i })
      .click();
    const canvas = frame.locator("svg").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("the drawing canvas has no box");

    // 二 — two horizontal strokes. Chosen because it is legible at this size and its shape survives
    // being drawn by straight-line interpolation, which a curvy character would not.
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
    await stroke(0.2, 0.65, 0.8, 0.65);

    // The recognizer loads its patterns lazily on the first stroke, so give the candidates a real
    // wait rather than the default. Their presence is the whole point of the shot.
    await expect(
      frame.getByRole("button", { name: /^二$|^Add /i }).first()
    ).toBeVisible({
      timeout: 20_000
    });
    return sidebar(win);
  });
});

/* ── The word page ───────────────────────────────────────────────────────── */

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

test("capture: the headword and its tags", async () => {
  // A CROP of the top of the entry: reading, pitch contour, writings, and the tag pills. The prose
  // labels these individually, and a whole-panel shot makes each one small.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "word-headword", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "食べる");
    await frame.getByRole("option").first().click();
    // Cropped from the BACK control down to the tag row, rather than from the reading itself: the
    // reading is rendered as pitch-contour markup rather than a plain text node, so matching it by
    // text picks up the conjugated forms further down the page instead.
    const top = frame.getByRole("button", { name: /back/i }).first();
    const tag = frame.getByRole("button", { name: /ichidan verb/i }).first();
    await expect(top).toBeVisible();
    await expect(tag).toBeVisible();
    return cropAround(win, [top, tag]);
  });
});

test("capture: the conjugation table", async () => {
  // Scrolled to the TOP of the panel, not merely into view: `scrollIntoViewIfNeeded` stops as soon
  // as the heading is technically visible, which left the earlier capture showing the heading at
  // the bottom edge and none of the table under it.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "conjugations", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "食べる");
    await frame.getByRole("option").first().click();
    const heading = frame.getByRole("heading", { name: /conjugation/i });
    await scrollToTop(heading);
    // A form from the table itself, so this cannot pass on the heading alone.
    await expect(frame.getByText("食べません").first()).toBeVisible();
    return sidebar(win);
  });
});

test("capture: the copy-as menu", async () => {
  // WHY: the menu's VALUE is the list of shapes it offers — word, reading, romaji, two furigana
  // markups — each previewed. That is unreadable at panel scale, so it is a crop.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "copy-as-menu", async () => {
    const frame = await jishoFrame(win);
    // Dismiss anything left open FIRST. An open menu is a modal overlay, and this scenario runs
    // twice (once per theme) — the second pass found the first pass's menu still up, so
    // `returnToSearch` could not reach the Back control underneath it.
    await win.keyboard.press("Escape");
    await returnToSearch(frame);
    await fillSearch(frame, "食べる");
    await frame.getByRole("option").first().click();
    await frame.getByRole("button", { name: /Copy 食べる as/ }).click();
    const menu = frame.getByRole("menu").first();
    await expect(menu).toBeVisible();
    // The furigana variants are the least obvious entries and the reason the menu exists.
    await expect(menu.getByText(/ruby|furigana/i).first()).toBeVisible();
    return cropAround(win, [menu]);
  });
  // And once more on the way out, so the NEXT scenario starts clean.
  await vscode!.window.keyboard.press("Escape");
});

test("capture: the example-sentence pool", async () => {
  // WHY: "20 more examples" opening a page of them is a claim the README makes; this is the page.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "more-examples", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "食べる");
    await frame.getByRole("option").first().click();
    await frame.getByRole("button", { name: /more examples/i }).click();
    // Furigana over the kanji is what distinguishes this page from a list of strings.
    await expect(frame.locator("ruby").first()).toBeVisible();
    return sidebar(win);
  });
});

/* ── Kanji ───────────────────────────────────────────────────────────────── */

test("capture: the kanji page", async () => {
  const win = vscode!.window;
  await captureBothThemes(vscode!, "kanji-page", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "水");
    await frame
      .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
      .first()
      .click();
    // The "On" reading row, matched exactly: a loose /on|kun/ matches half the English on the page.
    await expect(frame.getByText("On", { exact: true }).first()).toBeVisible();
    return sidebar(win);
  });
});

test("capture: stroke order, mid-animation", async () => {
  // Seeked to stroke 2 rather than left at 0: at the start the slider sits hard left and the
  // character is blank, which shows neither the progress control nor the drawing.
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
    await expect(frame.getByText(/\d+ strokes/)).toBeVisible();
    // The slider is a React Aria slider: arrow keys move it one stroke at a time.
    const slider = frame.getByRole("slider").first();
    await slider.focus();
    await slider.press("ArrowRight");
    await slider.press("ArrowRight");
    await expect(frame.getByText("2 / 4")).toBeVisible();
    return sidebar(win);
  });
});

test("capture: browsing kanji by level", async () => {
  // WHY: the kanji list renders as a GRID of characters, which looks nothing like the vocabulary
  // list. Showing the results is the point; the category navigation is already shown for Vocab.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "kanji-browse-list", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await frame
      .getByRole("tablist", { name: "Sections" })
      .getByRole("tab", { name: "Kanji" })
      .click();
    await frame.getByRole("button", { name: "Browse N5 kanji" }).click();
    await expect(frame.getByText("79 kanji")).toBeVisible();
    return sidebar(win);
  });
});

/* ── Browse ──────────────────────────────────────────────────────────────── */

test("capture: a category's subcategories", async () => {
  // The middle level of the drill-down: the groups inside JLPT level, with their word counts.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "browse-categories", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await frame
      .getByRole("tablist", { name: "Sections" })
      .getByRole("tab", { name: "Vocab" })
      .click();
    await frame.getByRole("button", { name: /Browse JLPT level/i }).click();
    await expect(
      frame.getByRole("button", { name: /N5, \d+ words/ })
    ).toBeVisible();
    return sidebar(win);
  });
});

test("capture: a word list in gojuon order", async () => {
  // WHY: this is where the vocabulary list shows its own shape — kana section headers, the jump
  // rail down the side, and the row format (headword, reading, badges, gloss).
  const win = vscode!.window;
  await captureBothThemes(vscode!, "browse-word-list", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await frame
      .getByRole("tablist", { name: "Sections" })
      .getByRole("tab", { name: "Vocab" })
      .click();
    await frame.getByRole("button", { name: /Browse JLPT level/i }).click();
    await frame.getByRole("button", { name: /N2, \d+ words/ }).click();
    // Gojūon is the default order, so the rail and the section headers are both present.
    await expect(
      frame.getByRole("navigation", { name: /jump to kana/i })
    ).toBeVisible();
    await expect(frame.getByRole("option").first()).toBeVisible();
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

/* ── In the editor ───────────────────────────────────────────────────────── */

test("capture: a hover in a study note", async () => {
  // WHY: a definition arriving without leaving the file is the one thing a screenshot shows that
  // prose cannot.
  //
  // A MARKDOWN fixture, not a code file. The hover provider registers for ["markdown", "plaintext"]
  // only (src/extension.ts), so Japanese in a .ts comment gets nothing — which is what several
  // rounds of failed automation here were actually telling us. Spec 18 covers extending it.
  const win = vscode!.window;
  await captureBothThemes(
    vscode!,
    "editor-hover",
    async () => {
      // Put the PANEL on the same word first. The editor hover and the panel entry are the two
      // halves of one feature, and a shot pairing the hover with whatever view the previous
      // scenario happened to leave open would be incoherent.
      const frame = await jishoFrame(win);
      await returnToSearch(frame);
      await fillSearch(frame, "毎日");
      await expect(frame.getByRole("option").first()).toBeVisible();

      await openFixture(win, "reading-notes.md");
      // Near the top of the file, so nothing needs scrolling: Monaco virtualises its lines, and an
      // off-screen one measures 0x0 at (0,0), which puts the pointer in the window's corner.
      const line = win
        .locator(".view-line", { hasText: "毎日日本語を勉強します" })
        .first();
      await expect(line).toBeVisible();
      const hover = await hoverEditorWord(
        win,
        "毎日日本語を勉強します",
        0,
        11,
        "毎日"
      );
      // Wait for the ENTRY, not merely the card: VS Code renders the hover shell immediately and
      // fills it in when the provider resolves, so a capture can catch "(loading...)".
      await expect(hover).not.toContainText("loading");
      return hover;
      // `keepPointer`: the card IS the subject, and parking the pointer dismisses it.
    },
    { keepPointer: true }
  );
});

test("capture: part-of-speech colouring in prose", async () => {
  // WHY: the feature is invisible in prose descriptions and obvious in a picture — word boundaries
  // become legible in text that has no spaces. Enabled for this run in `beforeAll`.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "pos-highlighting", async () => {
    // The study-notes fixture, which is PLAIN prose. The grammar guide wraps every word in ruby
    // markup ({魚|さかな}), and while the hover understands that, the colouring is easiest to read
    // where the braces are not breaking up the run.
    await openFixture(win, "reading-notes.md");
    const line = win.locator(".view-line", { hasText: "図書館" }).first();
    await expect(line).toBeVisible();
    // Wait for the DECORATIONS, not just the text. VS Code renders decoration types as generated
    // `ced-*` classes some time after the file paints, and an earlier capture caught the file
    // before they landed — a screenshot of the feature switched off. Measured: 53 Japanese spans
    // carry these classes once the tokenizer pass completes.
    await expect(
      win.locator(".view-line span[class*='TextEditorDecorationType']").first()
    ).toBeVisible({ timeout: 20_000 });
    // Cropped to the text rather than the whole editor: the fixture is short, so a full-pane shot
    // is mostly empty background with the subject in a strip at the top.
    //
    // Every line, not the first and the nth: Monaco reorders `.view-line` divs as it renders, so
    // DOM order is NOT visual order — `.first()` and `.nth(12)` picked the same visual line and the
    // crop came out one line tall. `cropAround` unions the boxes, so handing it all of them takes
    // the extent from geometry instead.
    return cropAround(win, await win.locator(".view-line").all(), 16);
  });
});

test("capture: furigana added to a study note", async () => {
  // WHY: "Add Furigana" is hard to describe and obvious in a picture. The fixture is a set of study
  // notes, which is where someone would actually reach for it.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "add-furigana", async () => {
    await openFixture(win, "reading-notes.md");
    await win.keyboard.press("ControlOrMeta+A");
    await runCommand(win, "Jisho: Add Furigana");
    // The ruby markup is the result. Assert it landed before shooting the editor.
    await expect(
      win.locator(".view-line").filter({ hasText: "|" }).first()
    ).toBeVisible();
    // Cropped to the text, like the colouring capture: the fixture fills a third of the pane and
    // the rest is empty background.
    return cropAround(win, await win.locator(".view-line").all(), 16);
  });
  // Undo the edit, per this file's contract that a scenario leaves things as it found them. This is
  // the only scenario that WRITES, and the cost of skipping it was a wrong hero image: the overview
  // capture reopens this same buffer and came out showing raw `{読書|どくしょ}` ruby markup.
  await runCommand(win, "File: Revert File");
  await expect(win.locator(".tab.dirty")).toHaveCount(0);
});

test("capture: the editor and the panel together", async () => {
  // WHY: the README needs one shot showing WHERE this lives — a file open, the panel beside it,
  // both showing Japanese. Every other capture is one half or the other.
  const win = vscode!.window;
  await captureBothThemes(vscode!, "overview", async () => {
    const frame = await jishoFrame(win);
    await returnToSearch(frame);
    await fillSearch(frame, "図書館");
    await expect(frame.getByRole("option").first()).toBeVisible();
    await openFixture(win, "reading-notes.md");
    return workbenchRegion(win);
  });
});
