import { test } from "../fixtures";
import { screenshotSidebar } from "../webview";

/**
 * The tag pills (#50). それぞれ is the word the backlog cites: its POS+usage line used to read
 * "adverb (fukushi), noun (common) (futsuumeishi), nouns which may take the genitive case particle
 * 'no', word usually written using kana alone".
 */
test("capture: tag pills on a heavily-tagged word", async ({
  vscode,
  jisho
}) => {
  await jisho.getByRole("searchbox").fill("それぞれ");
  await jisho
    .getByRole("option", { name: /それぞれ/ })
    .first()
    .click();
  await jisho.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(vscode.window, "test-results/shots/22-tag-pills.png");
});
