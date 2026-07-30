import { test } from "../fixtures";
import { openKanjiResult, screenshotSidebar } from "../webview";

/** The kanji page: readings and copy affordances, plus the F3 similar-kanji section. */
test.describe.configure({ mode: "serial" });

test("capture: kanji detail (readings, copy, stroke-order link)", async ({
  vscode,
  jisho
}) => {
  await openKanjiResult(jisho, "食");
  await jisho.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/13-kanji-detail.png"
  );
});

test("capture: kanji detail — similar kanji section (F3)", async ({
  vscode,
  jisho
}) => {
  // 未 has the classic confusable 末 at the top of its similar list.
  await openKanjiResult(jisho, "未");
  await jisho.getByRole("heading", { name: "Similar kanji" }).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/13b-kanji-similar.png"
  );
});
