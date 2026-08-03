import { test } from "../fixtures";
import { screenshotSidebar } from "../webview";

/** The search view: its empty state, and a query with both result sections populated. */
test.describe.configure({ mode: "serial" });

test("capture: empty search", async ({ vscode, jisho }) => {
  // `jisho` is requested for its effect, not its value: asking for it is what resets the view to an
  // empty search, which is the entire subject of this capture.
  await jisho.getByRole("searchbox").waitFor();
  await screenshotSidebar(vscode.window, "test-results/shots/10-empty.png");
});

test("capture: search results (words + kanji sections)", async ({
  vscode,
  jisho
}) => {
  await jisho.getByRole("searchbox").fill("食べる");
  await jisho.getByRole("option").first().waitFor();
  await screenshotSidebar(vscode.window, "test-results/shots/11-results.png");
});

test("capture: sentence breakdown bar (POS-coloured chips)", async ({
  vscode,
  jisho
}) => {
  // A whole sentence, so the query tokenizes into a breakdown bar rather than a single lookup.
  // The chips colour by part of speech from the shared `[data-pos]` mapping in posCategory.css —
  // the one the tag pills and example sentences also read, so a break here would be a break in all
  // three at once. No other capture exercises this surface.
  await jisho.getByRole("searchbox").fill("私は毎日日本語を勉強します");
  const chip = jisho.locator("[data-pos]").first();
  await chip.waitFor();
  // Prove a palette colour actually RESOLVES, not merely that the attribute is present: the unit
  // tests already assert the attribute, and moving the CSS could break the variable lookup without
  // touching the markup. Canvas normalises `oklch()`, which Chromium never serialises as `rgb()`.
  const coloured = await chip.evaluate((el) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.fillStyle = getComputedStyle(el).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    // A palette hue is chromatic; the theme foreground it falls back to is near-grey.
    return Math.max(r, g, b) - Math.min(r, g, b) > 10;
  });
  if (!coloured)
    throw new Error("breakdown chip did not resolve a palette colour");
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/11b-breakdown-bar.png"
  );
});
