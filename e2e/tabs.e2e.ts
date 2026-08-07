import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import {
  fillSearch,
  jishoFrame,
  openJishoSidebar,
  searchText
} from "./webview";

/**
 * The navigation root's tab bar (#55 step 1).
 *
 * E2E rather than component-level because the behaviour under test spans the machine, the tab
 * panels and the search box at once — the same reason #16's caret regression was invisible to
 * component tests. In particular, "the tab remembers where you were" is a claim about panels NOT
 * unmounting, which only a real render can settle.
 */
test.describe.configure({ mode: "serial" });

let vscode: Launched | undefined;

test.beforeAll(async () => {
  vscode = await launchVSCode({});
  await openJishoSidebar(vscode.window);
});
test.afterAll(async () => {
  await vscode?.close();
});

test("offers the four sections", async () => {
  const win = vscode!.window;
  const frame = await jishoFrame(win);
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  await expect(tabs).toBeVisible();
  for (const name of ["Search", "Vocab", "Kanji", "Kana"]) {
    await expect(tabs.getByRole("tab", { name })).toBeVisible();
  }
  await win.screenshot({ path: "test-results/shots/25-tabs-search.png" });

  await tabs.getByRole("tab", { name: "Vocab" }).click();
  await win.screenshot({ path: "test-results/shots/26-tabs-vocab.png" });
});

test("switching tabs preserves what each one was showing", async () => {
  // WHY: this is the entire reason the panels are force-mounted. Type a query, leave, come back —
  // the query must still be there, because the Search panel was hidden rather than unmounted.
  // Measured at the component level too (a panel remounts without `shouldForceMount`), but this is
  // the claim as a user experiences it.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });

  // These tests share one window in serial order, so each starts by selecting the tab it needs
  // rather than inheriting whichever one the previous test left selected.
  await tabs.getByRole("tab", { name: "Search" }).click();
  await fillSearch(frame, "食べる");
  expect(await searchText(frame)).toBe("食べる");

  await tabs.getByRole("tab", { name: "Vocab" }).click();
  await expect(frame.getByRole("searchbox")).toBeHidden();

  await tabs.getByRole("tab", { name: "Search" }).click();
  expect(await searchText(frame)).toBe("食べる");
});

test("the Vocab tab drills in and back out by breadcrumb", async () => {
  // WHY: inside a tab there is no stack, so the drill level is component state and "up" is a
  // breadcrumb rather than Back. Both directions have to work without touching history.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  await tabs.getByRole("tab", { name: "Vocab" }).click();

  await frame.getByRole("button", { name: "Browse JLPT level" }).click();
  await expect(frame.getByRole("link", { name: "Browse" })).toBeVisible();

  await frame.getByRole("link", { name: "Browse" }).click();
  await expect(
    frame.getByRole("button", { name: "Browse JLPT level" })
  ).toBeVisible();
});

/** Back to the group list, so the next test does not inherit a drilled-in Vocab tab. */
const resetVocab = async (
  frame: Awaited<ReturnType<typeof jishoFrame>>
): Promise<void> => {
  const up = frame.getByRole("link", { name: "Browse" });
  if (await up.isVisible()) await up.click();
};

test("a drill level survives leaving the tab and returning", async () => {
  // WHY: the payoff of force-mounting, on the tab whose state is NOT in the machine at all.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });

  await tabs.getByRole("tab", { name: "Vocab" }).click();
  await resetVocab(frame);
  await frame.getByRole("button", { name: "Browse JLPT level" }).click();
  await expect(frame.getByRole("link", { name: "Browse" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Kana" }).click();
  await tabs.getByRole("tab", { name: "Vocab" }).click();
  // Still one level deep, not reset to the group list.
  await expect(frame.getByRole("link", { name: "Browse" })).toBeVisible();
  await resetVocab(frame);
});

test("opening a word hides the tabs, and Back brings them back", async () => {
  // WHY: on a word page the tabs are irrelevant chrome — the spec's rule that the bar renders only
  // at depth 1. If it stayed, a detail view would appear to belong to whichever tab was selected.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });

  await tabs.getByRole("tab", { name: "Search" }).click();
  await fillSearch(frame, "食べる");
  await frame.getByRole("option").first().click();
  await expect(tabs).toBeHidden();

  await frame.getByRole("button", { name: /back/i }).click();
  await expect(tabs).toBeVisible();
});

test("returns to the tab you left after the sidebar is collapsed", async () => {
  // WHY: `<Activity>`-style preservation dies with the document, and VSCode deallocates the webview
  // when the sidebar is collapsed. The active tab is the ONE piece of this state the machine
  // persists, precisely so reopening does not dump the user back on Search.
  const win = vscode!.window;
  const frame = await jishoFrame(win);
  await frame
    .getByRole("tablist", { name: "Sections" })
    .getByRole("tab", { name: "Kanji" })
    .click();

  // Collapse and reopen the sidebar, which destroys and recreates the webview document.
  await win.keyboard.press("ControlOrMeta+b");
  await openJishoSidebar(win);

  const reopened = await jishoFrame(win);
  await expect(
    reopened
      .getByRole("tablist", { name: "Sections" })
      .getByRole("tab", { name: "Kanji" })
  ).toHaveAttribute("aria-selected", "true");
});
