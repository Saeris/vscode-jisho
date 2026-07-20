import { test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import {
  jishoFrame,
  openJishoSidebar,
  returnToSearch,
  screenshotSidebar
} from "./webview";

/**
 * Light-theme contrast audit: its own VS Code launch with the theme pre-seeded in settings —
 * driving the theme picker at runtime proved racy (focus lives inside the webview, and the palette
 * steps outran the quick-input). Stock "Default Light Modern" ships in every install; derived
 * colors (--jisho-inflection and friends) must stay legible here, not just on dark themes.
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode({
    "workbench.colorTheme": "Default Light Modern"
  });
  await openJishoSidebar(app().window);
});

test.afterAll(async () => {
  await vscode?.close();
});

test("capture: word detail in light theme (contrast audit)", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame.getByRole("heading", { name: "Conjugations" }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/16-word-detail-light.png"
  );
});

test("capture: stroke order in light theme", async () => {
  const frame = await jishoFrame(app().window);
  await returnToSearch(frame);
  await frame.getByRole("searchbox").fill("近");
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
  await frame.getByRole("button", { name: /stroke order/i }).click();
  await frame.getByRole("slider").waitFor();
  // Park the pointer: it comes to rest over the canvas after the click, which hover-highlights a
  // part and makes the capture nondeterministic.
  await app().window.mouse.move(0, 0);
  await screenshotSidebar(
    app().window,
    "test-results/shots/16b-stroke-order-light.png"
  );
});
