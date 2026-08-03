import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import { fillSearch, jishoFrame, openJishoSidebar } from "./webview";

/**
 * The settings pipeline end-to-end: a launch with every Jisho setting overridden in the seeded
 * profile proves each delivery path — webview CSS variables (textScale, guideStyle), settings a
 * component RENDERS from (tagLabels), and host-side gates (hover.enabled, highlighting.enabled) —
 * without touching the Settings UI.
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode({
    "vscode-jisho.appearance.textScale": 1.5,
    "vscode-jisho.strokeOrder.guideStyle": "aligned",
    "vscode-jisho.hover.enabled": false,
    "vscode-jisho.highlighting.enabled": true,
    "vscode-jisho.appearance.tagLabels": "japanese",
    "vscode-jisho.appearance.colorExamples": false
  });
  await openJishoSidebar(app().window);
});

test.afterAll(async () => {
  await vscode?.close();
});

test("textScale reaches the webview as a font-size multiplier", async () => {
  const frame = await jishoFrame(app().window);
  // VS Code's default font size is 13px; 1.5× ≈ 19.5px. Anything ≥ 18 proves the multiplier
  // applied (the default 1.08 would be ~14px). Poll: the settings push lands just after the
  // webview becomes queryable, so the very first read can race it.
  await expect
    .poll(
      async () =>
        Number.parseFloat(
          await frame
            .locator("body")
            .evaluate((el) => getComputedStyle(el).fontSize)
        ),
      { timeout: 10_000 }
    )
    .toBeGreaterThanOrEqual(18);
});

test("guideStyle=aligned flips the stroke player's arrow variant", async () => {
  const frame = await jishoFrame(app().window);
  await fillSearch(frame, "近");
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
  await frame.getByRole("button", { name: /stroke order/i }).click();
  await frame.getByRole("slider").waitFor();
  // At playhead 0 only stroke 1's guide shows; aligned visible, offset hidden — the inverse of
  // the default.
  const opacity = async (selector: string): Promise<string> =>
    frame
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).opacity);
  expect(await opacity("svg.acjk .guides path.g1.aligned")).toBe("1");
  expect(await opacity("svg.acjk .guides path.g1.offset")).toBe("0");
});

test("tagLabels=japanese relabels the grammar pills", async () => {
  const frame = await jishoFrame(app().window);
  // These cases share one VS Code instance (serial mode), so the sidebar is still parked on the
  // previous test's kanji detail. "Back to search" is the Home control's accessible name — it
  // collapses the whole stack in one press, unlike Back.
  await frame.getByRole("button", { name: "Back to search" }).click();
  await fillSearch(frame, "食べる");
  await frame.locator('[role="listbox"] [role="option"]').first().click();
  await frame.getByRole("button", { name: "Back", exact: true }).waitFor();
  // The DEFAULT would render "ichidan verb" here. Proving the Japanese term shows instead is what
  // confirms the setting travelled the whole path — package.json → host snapshot → bridge →
  // `useHostSettings` → pill — since none of the unit tests cross the host boundary.
  const pill = frame
    .getByTitle(/ichidan/i)
    .locator("visible=true")
    .first();
  await expect(pill).toHaveText("一段動詞");
  // The description survives as the tooltip: in this mode it is the ONLY place a learner who does
  // not yet read 一段動詞 can find out what it means.
  await expect(pill).toHaveAttribute("title", /ichidan/i);
  // Reference shot for the word-detail design iteration (BACKLOG #32), Japanese-label variant.
  await app().window.screenshot({
    path: "test-results/shots/04-tag-labels-japanese.png"
  });
});

test("colorExamples=false leaves example words uncoloured but still tappable", async () => {
  const frame = await jishoFrame(app().window);
  // Still on 食べる's page from the previous case; its examples are the surface under test. The
  // linked words are the `[lang="ja"]` buttons — the same selector the smoke suite taps.
  const words = frame.locator('[lang="ja"] button').first();
  await words.waitFor();
  // The attribute is OMITTED when the setting is off, which is what makes the words fall back to
  // the foreground colour with no "off" CSS rule of their own.
  await expect(words).not.toHaveAttribute("data-pos");
  // The setting is about COLOUR, not linkification — the word must still open its entry, or this
  // would be silently disabling the F1-links feature instead.
  await expect(words).toBeEnabled();
});

test("hover.enabled=false suppresses the dictionary hover", async () => {
  const win = app().window;
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  await win.keyboard.type("食べました");
  const word = win.locator(".view-line", { hasText: "食べました" }).first();
  await word.waitFor();
  await word.locator("span span").first().hover();
  // The enabled case appears within ~1s (smoke suite); give the disabled case 4s to prove absence.
  await win.waitForTimeout(4000);
  await expect(
    win.locator(".monaco-hover-content").filter({ hasText: "to eat" })
  ).toHaveCount(0);
});

test("highlighting.enabled colors Japanese by part of speech", async () => {
  const win = app().window;
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  // The palette's reference sentence — the same one docs/pos-palettes.md renders. It exercises
  // every colour-bearing category in one line:
  //   もしもし utterance · 私 pronoun · は/で/を particle · 大きな adnominal · 声/お話 noun
  //   · 面白い adjective · ゆっくり adverb · 読み verb · まし/た auxiliary
  const SENTENCE = "もしもし、私は大きな声で面白いお話をゆっくり読みました。";
  await win.keyboard.type(SENTENCE);
  const word = win.locator(".view-line", { hasText: SENTENCE }).first();
  await word.waitFor();
  // Decorations apply asynchronously (the host tokenizes, then pushes ranges), so poll.
  //
  // Asserting many distinct colours, not merely "more than one": a single colour plus the
  // caret-line/selection styling already clears >1, so that weaker check passed even when nothing
  // was coloured.
  // Read each span's colour and normalise it to sRGB channels IN THE BROWSER. `getComputedStyle`
  // serialises our `oklch()` values as `oklch(...)` or `color(srgb ...)` — not `rgb(...)` — so
  // parsing the string here would silently match nothing. Canvas does the conversion for us.
  const colours = async (): Promise<Array<[number, number, number]>> =>
    word.evaluate((el) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      const seen = new Map<string, [number, number, number]>();
      for (const span of el.querySelectorAll("span")) {
        if (span.textContent.trim() === "") continue;
        const css = getComputedStyle(span).color;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        seen.set(`${r},${g},${b}`, [r, g, b]);
      }
      return [...seen.values()];
    });
  // Six or more: the sentence spans nine categories, but Monaco merges adjacent spans that share a
  // colour, and particles repeat — so the rendered count is a floor, not the category count.
  await expect
    .poll(async () => (await colours()).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(6);

  // And they must be OUR palette rather than the theme's own token colours. Each category sits at
  // a known hue (noun 247.5° blue, particle 112.5° olive, verb 22.5° coral), so checking that the
  // rendered colours span a wide hue range distinguishes the palette from any single-hue fallback
  // — without pinning exact values, which would break the moment the palette is retuned.
  const hues = (await colours())
    .map(([r, g, b]) => {
      const [rn, gn, bn] = [r, g, b].map((v) => v / 255);
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      if (max - min < 0.04) return null; // greyscale: the theme foreground, not a palette colour
      const h =
        max === rn
          ? ((gn - bn) / (max - min) + 6) % 6
          : max === gn
            ? (bn - rn) / (max - min) + 2
            : (rn - gn) / (max - min) + 4;
      return h * 60;
    })
    .filter((h) => h !== null);
  // Five or more genuinely different hues, bucketed at 30°. The standard palette spreads its nine
  // categories around the whole wheel, so a single-hue fallback (or the theme's own foreground)
  // could never produce this spread.
  expect(
    new Set(hues.map((h) => Math.round(h / 30))).size
  ).toBeGreaterThanOrEqual(5);

  // Reference shot for the POS-coloring design iteration (BACKLOG #38).
  await win.screenshot({ path: "test-results/shots/03-pos-highlighting.png" });
});
