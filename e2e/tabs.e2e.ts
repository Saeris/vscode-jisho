import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import {
  currentCrumb,
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
  await expect(frame.getByRole("link", { name: "Vocab" })).toBeVisible();

  await frame.getByRole("link", { name: "Vocab" }).click();
  await expect(
    frame.getByRole("button", { name: "Browse JLPT level" })
  ).toBeVisible();
});

/** Back to the group list, so the next test does not inherit a drilled-in Vocab tab. */
const resetVocab = async (
  frame: Awaited<ReturnType<typeof jishoFrame>>
): Promise<void> => {
  const up = frame.getByRole("link", { name: "Vocab" });
  if (await up.isVisible()) await up.click();
};

test("a drill level survives leaving the tab and returning", async () => {
  // WHY: the payoff of force-mounting, on the tab whose state is NOT in the machine at all.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });

  await tabs.getByRole("tab", { name: "Vocab" }).click();
  await resetVocab(frame);
  await frame.getByRole("button", { name: "Browse JLPT level" }).click();
  await expect(frame.getByRole("link", { name: "Vocab" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Kana" }).click();
  await tabs.getByRole("tab", { name: "Vocab" }).click();
  // Still one level deep, not reset to the group list.
  await expect(frame.getByRole("link", { name: "Vocab" })).toBeVisible();
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

test("the Kanji tab drills into a JLPT level and opens a character", async () => {
  // WHY (#55 step 2): the list count is the visible proof the JLPT import landed — N5 is 79 kanji,
  // asserted in the build and in db.spec, and this checks the number a user actually sees. Tapping
  // through then confirms the grid reaches a real detail page rather than a dead cell.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  await tabs.getByRole("tab", { name: "Kanji" }).click();

  await frame.getByRole("button", { name: "Browse N5 kanji" }).click();
  await expect(frame.getByText("79 kanji")).toBeVisible();
  // The trail replaced this level's heading, so the crumb IS the title — and the root crumb names
  // the tab, which is what makes "up" mean the group list rather than somewhere in the stack.
  await expect(currentCrumb(frame, "N5")).toBeVisible();
  await expect(frame.getByRole("link", { name: "Kanji" })).toBeVisible();
  await vscode!.window.screenshot({
    path: "test-results/shots/27-kanji-n5.png"
  });
  // The caveat text, which is the part that stops the counts reading as wrong.
  await expect(frame.getByText(/per level, not cumulative/)).toBeHidden();

  // 日 leads the list — most frequent first.
  await frame.getByRole("option").first().click();
  await expect(tabs).toBeHidden();
  await frame.getByRole("button", { name: /back/i }).click();
  await expect(tabs).toBeVisible();
});

test("the Kana tab switches script with one toggle", async () => {
  // WHY (#55 step 3): katakana is DERIVED from the hiragana table by codepoint rather than stored,
  // so the toggle is the only place that derivation is visible to a user. し→シ is the check that
  // it reaches the rendered cell, not just the helper the unit spec covers.
  const win = vscode!.window;
  const frame = await jishoFrame(win);
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  await tabs.getByRole("tab", { name: "Kana" }).click();

  const chart = frame.getByRole("listbox", { name: "Gojūon chart" });
  await expect(chart.getByRole("option", { name: "し shi" })).toBeVisible();
  await win.screenshot({ path: "test-results/shots/28-kana-hiragana.png" });

  await frame.getByRole("radio", { name: "Katakana" }).click();
  await expect(chart.getByRole("option", { name: "シ shi" })).toBeVisible();
  await expect(chart.getByRole("option", { name: "し shi" })).toBeHidden();
  await win.screenshot({ path: "test-results/shots/29-kana-katakana.png" });

  // Back to hiragana, so the next test does not inherit the katakana chart.
  await frame.getByRole("radio", { name: "Hiragana" }).click();
});

test("tapping a kana opens its stroke order", async () => {
  // WHY: the tab's only action, and the one part of it a component test cannot settle — the drawing
  // is fetched from the HOST by filename, so this proves the kana SVGs are actually in the package
  // and reachable, not just that the view sends the right event. あ is the sharp case: upstream
  // splits its third stroke into two clipped fragments, so a build that counted pieces instead of
  // strokes would say 4 here.
  const win = vscode!.window;
  const frame = await jishoFrame(win);
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  await tabs.getByRole("tab", { name: "Kana" }).click();

  await frame
    .getByRole("listbox", { name: "Gojūon chart" })
    .getByRole("option", { name: "あ a" })
    .click();

  // A pushed detail view, so the tab bar goes away like it does for a word or kanji.
  await expect(tabs).toBeHidden();
  await expect(frame.getByText("3 strokes")).toBeVisible();
  await win.screenshot({ path: "test-results/shots/30-kana-strokes.png" });

  await frame.getByRole("button", { name: /back/i }).click();
  await expect(tabs).toBeVisible();
});

test("a digraph is inert, having no drawing to open", async () => {
  // WHY: きゃ is two code points and drawings are served by one-code-point filename, so there is
  // nothing to show. Without the disabled state a tap would push an empty stroke-order page, which
  // reads as a broken feature rather than an absent one.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  await tabs.getByRole("tab", { name: "Kana" }).click();

  // Asserted rather than clicked: Playwright refuses to click a disabled element, so a `.click()`
  // here would hang for its full timeout and then report a Playwright limitation rather than the
  // app's behaviour. The disabled state IS the behaviour under test.
  await expect(
    frame
      .getByRole("listbox", { name: "Yōon chart" })
      .getByRole("option", { name: "きゃ kya" })
  ).toBeDisabled();
  await expect(tabs).toBeVisible();
});

test("the Kana script survives leaving the tab and returning", async () => {
  // WHY: the script is component state kept alive by force-mounting, exactly like the Vocab tab's
  // drill level — and it is the ONLY state the Kana tab has, so if force-mounting ever regresses
  // here the toggle silently resets under the user.
  const frame = await jishoFrame(vscode!.window);
  const tabs = frame.getByRole("tablist", { name: "Sections" });
  await tabs.getByRole("tab", { name: "Kana" }).click();
  await frame.getByRole("radio", { name: "Katakana" }).click();

  const chart = frame.getByRole("listbox", { name: "Gojūon chart" });
  await expect(chart.getByRole("option", { name: "シ shi" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Vocab" }).click();
  await tabs.getByRole("tab", { name: "Kana" }).click();
  await expect(chart.getByRole("option", { name: "シ shi" })).toBeVisible();

  await frame.getByRole("radio", { name: "Hiragana" }).click();
});
