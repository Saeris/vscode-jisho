import { test } from "../fixtures";
import { screenshotSidebar } from "../webview";

/** The handwriting recognizer's entry surface. */
test("capture: handwriting view", async ({ vscode, jisho }) => {
  // By accessible name, not by its ✏️ glyph: the emoji is presentation that a restyle could change,
  // while the label is the contract screen-reader users rely on. Matching the label also means this
  // fails loudly if the button is renamed, rather than silently finding nothing and timing out.
  await jisho.getByRole("button", { name: "Draw a kanji to search" }).click();
  await jisho.getByText(/stroke order and count/i).waitFor();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/14-handwriting.png"
  );
});
