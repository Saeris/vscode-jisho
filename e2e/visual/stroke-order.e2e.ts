import { test } from "../fixtures";
import { openKanjiResult, screenshotSidebar } from "../webview";

/** The stroke-order sub-page: the player, the chart, and part highlighting. */
test.describe.configure({ mode: "serial" });

test("capture: stroke order sub-page (player + chart)", async ({
  vscode,
  jisho
}) => {
  await openKanjiResult(jisho, "近");
  await jisho.getByRole("button", { name: /stroke order/i }).click();
  await jisho.getByRole("slider").waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/15-stroke-order.png"
  );

  // Part highlighting: hovering the inner 斤 hit-box must tint its strokes (radical ⻌'s box covers
  // most of the canvas but paints underneath, so the inner part wins the hover).
  // .first(): the chart cells repeat the SVG (their rects are display:none); the player's is first.
  await jisho
    .locator('svg.acjk .parts rect[data-literal="斤"]')
    .first()
    .hover();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/15b-stroke-part-hover.png"
  );
});
