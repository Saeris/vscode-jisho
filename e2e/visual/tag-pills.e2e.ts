import { test } from "../fixtures";
import { fillSearch, screenshotSidebar } from "../webview";

/**
 * The tag pills (#50). それぞれ is the word the backlog cites: its POS+usage line used to read
 * "adverb (fukushi), noun (common) (futsuumeishi), nouns which may take the genitive case particle
 * 'no', word usually written using kana alone".
 *
 * Captures the DEFAULT English labels, since this fixture launches with default settings. The
 * Japanese variant is captured in `settings.e2e.ts`, which pays its own launch precisely because
 * `tagLabels` has to be seeded before the extension activates.
 */
test("capture: tag pills on a heavily-tagged word", async ({
  vscode,
  jisho
}) => {
  await fillSearch(jisho, "それぞれ");
  await jisho
    .getByRole("option", { name: /それぞれ/ })
    .first()
    .click();
  await jisho.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(vscode.window, "test-results/shots/22-tag-pills.png");
});
