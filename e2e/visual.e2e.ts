import { test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import { jishoFrame, openJishoSidebar, screenshotSidebar } from "./webview";

/**
 * The visual-iteration loop: drive each surface and capture the sidebar so the UI can be reviewed
 * against real pixels. These are deliberately NOT assertions — they're a screenshot harness for
 * refining layout/spacing/theming. Visual-regression baselines come later, after the polish work
 * (locking baselines of a UI we're about to change would be backwards).
 *
 * Run: vp exec playwright test visual.e2e.ts   → shots land in test-results/shots/
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;
const app = (): Launched => {
  if (!vscode) throw new Error("VS Code was not launched");
  return vscode;
};

test.beforeAll(async () => {
  vscode = await launchVSCode();
  await openJishoSidebar(app().window);
});

test.afterAll(async () => {
  await vscode?.close();
});

test("capture: empty search", async () => {
  await jishoFrame(app().window);
  await screenshotSidebar(app().window, "test-results/shots/10-empty.png");
});

test("capture: search results (words + kanji sections)", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("食べる");
  await frame.getByRole("option").first().waitFor();
  await screenshotSidebar(app().window, "test-results/shots/11-results.png");
});

test("capture: word detail (pitch contour, JLPT badge, examples)", async () => {
  const frame = await jishoFrame(app().window);
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await frame.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/12-word-detail.png"
  );
});

test("capture: word detail — examples expanded", async () => {
  // Self-contained: navigate from search rather than depending on the previous capture's state.
  const frame = await jishoFrame(app().window);
  const back = frame.getByRole("button", { name: /back/i });
  if (await back.isVisible().catch(() => false)) await back.click();
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  // The disclosure trigger is a plain <button> whose text is "Examples (n)" (confirmed by dumping
  // the live DOM — getByRole with a name filter proved unreliable across the mounted-but-hidden
  // search view that <Activity> keeps in the tree).
  await frame
    .locator("button", { hasText: /^Examples/ })
    .first()
    .click();
  await screenshotSidebar(
    app().window,
    "test-results/shots/12b-word-detail-examples.png"
  );
});

test("capture: kanji detail (stroke player)", async () => {
  const frame = await jishoFrame(app().window);
  // Get back to search first — a previous capture may have left a detail view on the stack.
  const back = frame.getByRole("button", { name: /back/i });
  if (await back.isVisible().catch(() => false)) await back.click();

  await frame.getByRole("searchbox").fill("食");
  // Target the Kanji section's listbox specifically. Both sections render `role=option`, and the
  // kanji row's accessible name is the whole row ("食eat, foodショク、ジキ…"), not just the literal —
  // so match by the section's aria-label and take its first option (confirmed via a DOM dump).
  await frame
    .locator('[role="listbox"][aria-label="Kanji results"] [role="option"]')
    .first()
    .click();
  await frame.getByRole("button", { name: /back/i }).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/13-kanji-detail.png"
  );
});

test("capture: handwriting view", async () => {
  const frame = await jishoFrame(app().window);
  // Return to search if a previous capture left a detail view pushed — the toolbar only exists there.
  const back = frame.getByRole("button", { name: /back/i });
  if (await back.isVisible().catch(() => false)) await back.click();
  // The ✏️ toolbar button (its accessible name comes from aria-label="Draw a kanji to search").
  await frame.locator("button", { hasText: "✏️" }).first().click();
  await frame.getByText(/stroke order and count/i).waitFor();
  await screenshotSidebar(
    app().window,
    "test-results/shots/14-handwriting.png"
  );
});
