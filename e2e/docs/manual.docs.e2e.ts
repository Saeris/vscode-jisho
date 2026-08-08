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
  sliceOfPanel,
  useSidebarWidth,
  widenSidebar,
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

/**
 * A REQUESTED window size, so the full-app captures do not inherit whatever geometry the developer's
 * display last used.
 *
 * Requested rather than guaranteed: this goes to Chromium's `--window-size`, and VS Code restores
 * its own persisted geometry over it, so the window settles at 1440x900 (16:10) rather than exactly
 * this. That is a fine embed ratio, and `workbenchRegion` explains why it is not forced to 16:9.
 * The value still matters — it pins the WIDTH, which is what the sidebar/editor split is measured
 * against.
 */
const WINDOW = { width: 1440, height: 810 };

/**
 * Just past the panel's `@container (max-width: 379px)` breakpoint, so the conjugation table
 * documents its three-column form rather than the narrow stacked one. See `widenSidebar`.
 *
 * Not 380, and the difference is measured rather than guessed: the breakpoint is on the CONTAINER
 * (`.conjugations`), which sits inside the panel's chrome, and the container runs 27px narrower than
 * the side bar (373 at 400, 383 at 410, 393 at 420). So the query clears 379 at a side bar of 407 or
 * more. 410 is the first round number past that, which keeps the capture close to a width someone
 * would plausibly dock rather than showing an unusually wide panel.
 */
const SIDEBAR_WIDTH = 410;

test.beforeAll(async () => {
  vscode = await launchVSCode(
    {
      "workbench.sideBar.location": "left",
      // Part-of-speech colouring is OFF by default, but it is a headline feature and the editor
      // captures are where it shows. Turning it on here documents what it looks like rather than
      // what the defaults are.
      "vscode-jisho.highlighting.enabled": true
    },
    { windowSize: WINDOW }
  );
  await openJishoSidebar(vscode.window);
  useSidebarWidth(SIDEBAR_WIDTH);
  await widenSidebar(vscode.window, SIDEBAR_WIDTH);

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
    // A query in the field, not an empty one. An empty box photographs as an unfinished control and
    // says nothing about what gets typed into it; a romaji query also shows that the field takes
    // more than kana or kanji, which is the least discoverable thing about it.
    await fillSearch(frame, "toshokan");
    const box = frame.getByRole("searchbox");
    const about = frame.getByRole("button", { name: /about this extension/i });
    await expect(box).toBeVisible();
    await expect(about).toBeVisible();
    // Down to the first result, so the strip has something under it. Cropped to the field and its
    // icons alone this was a ~40px band floating in isolation — the toolbar reads as part of a
    // search panel only when you can see it sitting above what it searches.
    // Two rows, so the crop ends on a whole one. Bounding to the first result alone cut the second
    // through the middle, which reads as a rendering glitch rather than a deliberate edge.
    const firstHit = frame.getByRole("option").first();
    const secondHit = frame.getByRole("option").nth(1);
    await expect(firstHit).toBeVisible();
    await expect(secondHit).toBeVisible();
    return sliceOfPanel(win, [box, about, secondHit]);
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
    // 目 (eye) + 貝 (shell), rather than a pairing spread across the list. BOTH selections need to
    // be in the same frame or the picture cannot show what multi-radical filtering does — an
    // earlier pairing put one of them well above the fold, so the capture showed a single
    // highlighted radical and a result list, which is indistinguishable from a one-radical search.
    const eye = frame.getByRole("button", { name: "目", exact: true });
    await eye.click();
    await frame.getByRole("button", { name: "貝", exact: true }).click();
    // Results are what the capture is for, so wait for one before shooting.
    await expect(
      frame.getByRole("button", { name: /^Open .+:/ }).first()
    ).toBeVisible();
    // Pin the picker's scroll position, so both themes frame the SAME radicals.
    //
    // Clicking a radical scrolls its list, and the two passes settled at different offsets — the
    // light and dark captures showed different parts of the grid and appeared to disagree about
    // which radicals were selected. Scrolling 目 to the top is a fixed reference both passes reach,
    // and it also guarantees the first selection is actually IN frame, which it previously was not.
    await scrollToTop(eye);
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

    /*
     * One stroke, drawn the way a pen draws it.
     *
     * The ink is `perfect-freehand` with `thinning: 0.6`, which derives width from VELOCITY. The
     * first version of this interpolated in eight equal steps, so every sample had identical
     * velocity and the outline came out a uniform bar — the picture lost the pressure-sensitive
     * ink that is half of what makes the canvas feel like writing.
     *
     * Easing fixes that at the source rather than faking a width: `sin²` starts slow, accelerates
     * through the middle and settles at the end, so the stroke renders thin at the entry, full
     * through the body, and tapered at the exit. More samples because the outline is only as smooth
     * as the points it is built from.
     */
    const stroke = async (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      /**
       * How far the stroke bows away from the straight line between its ends, as a fraction of the
       * canvas. Positive bows left/up.
       *
       * Straight segments alone drew a convincing "4" rather than a partial 年 — the opening
       * left-falling stroke (ノ) of 年 is CURVED, and rendering it as a diagonal line is what made
       * the drawing read as the wrong character. A quadratic bend is enough to carry the difference.
       */
      bow = 0
    ): Promise<void> => {
      const steps = 24;
      await win.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
      await win.mouse.down();
      for (let i = 1; i <= steps; i++) {
        const t = Math.sin((Math.PI / 2) * (i / steps)) ** 2;
        // Perpendicular offset, peaking at the middle of the stroke and vanishing at both ends.
        const bend = bow * 4 * t * (1 - t);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        await win.mouse.move(
          box.x + box.width * (x1 + dx * t - (dy / len) * bend),
          box.y + box.height * (y1 + dy * t + (dx / len) * bend)
        );
      }
      await win.mouse.up();
    };

    /*
     * The first four strokes of 年 — deliberately PARTIAL.
     *
     * A complete, unambiguous character makes a dull picture: one candidate, and nothing to show for
     * the ranking. 年 is dense with near neighbours (牛 生 午 毎 年), so a partial drawing puts
     * several plausible characters in the list and demonstrates what the candidate strip is FOR —
     * you do not have to finish, or to know the stroke count, to find what you are after.
     */
    await stroke(0.54, 0.14, 0.3, 0.36, 0.04); // ノ — curved, left-falling
    await stroke(0.28, 0.36, 0.72, 0.36); // upper horizontal
    await stroke(0.26, 0.58, 0.78, 0.58); // second horizontal
    // The long vertical, DROPPING WELL BELOW the lower bar. This is the stroke that separates 年
    // from 牛/午 and from a handwritten "4": stopping it at the bar left a drawing that read as the
    // digit, whatever the surrounding strokes did.
    await stroke(0.5, 0.2, 0.5, 0.84);

    // The recognizer loads its patterns lazily on the first stroke, so give the candidates a real
    // wait rather than the default. Their presence is the whole point of the shot.
    //
    // Asserts that SOME candidate appeared rather than naming one: the ranking of a partial drawing
    // is the recognizer's business, and pinning an exact character here would make this capture
    // fail on a legitimate scoring change rather than on a broken feature. A candidate button's
    // accessible name is the character itself, so they are matched as single CJK glyphs — the hint
    // paragraph they replace is not a button, so this cannot pass on an empty strip.
    await expect(
      frame.getByRole("button", { name: /^[一-鿿]$/u }).first()
    ).toBeVisible({ timeout: 20_000 });
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
    // A panel-width SLICE, not the union of those two boxes: cropping tight to them gave a 94px
    // sliver that clipped the pitch contour and cut the tag pills mid-word.
    return sliceOfPanel(win, [top, tag]);
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
    const trigger = frame.getByRole("button", { name: /Copy 食べる as/ });
    await trigger.click();
    const menu = frame.getByRole("menu").first();
    await expect(menu).toBeVisible();
    // The furigana variants are the least obvious entries and the reason the menu exists.
    await expect(menu.getByText(/ruby|furigana/i).first()).toBeVisible();
    // The TRIGGER is in frame too, and the crop runs the panel's full width. A shot of the menu
    // alone is a floating list of options with nothing to say where it came from — the point is
    // that a control on the entry opens it.
    return sliceOfPanel(win, [trigger, menu]);
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
      await fillSearch(frame, "今日");
      await expect(frame.getByRole("option").first()).toBeVisible();

      await openFixture(win, "reading-notes.md");
      // Near the top of the file, so nothing needs scrolling: Monaco virtualises its lines, and an
      // off-screen one measures 0x0 at (0,0), which puts the pointer in the window's corner.
      const line = win
        .locator(".view-line", { hasText: "毎日日本語を勉強します" })
        .first();
      await expect(line).toBeVisible();
      // 今日, twelve characters in, rather than 毎日 at the start of the line: the card is anchored
      // under the word it explains, so hovering the first word pinned it to the left edge of the
      // crop. A word mid-line centres it under the prose.
      const hover = await hoverEditorWord(
        win,
        "毎日日本語を勉強します",
        12,
        25,
        "今日"
      );
      // Wait for the ENTRY, not merely the card: VS Code renders the hover shell immediately and
      // fills it in when the provider resolves, so a capture can catch "(loading...)".
      await expect(hover).not.toContainText("loading");
      // The TEXT as well as the card. Cropped to the card alone this is a definition floating on a
      // background — you cannot tell it came from pointing at a word in a document, which is the
      // whole feature. Including the lines it covers shows the prose, the pointer's target, and the
      // answer in one frame.
      return cropAround(
        win,
        [...(await win.locator(".view-line").all()), hover],
        16
      );
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
