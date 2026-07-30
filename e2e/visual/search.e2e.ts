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
