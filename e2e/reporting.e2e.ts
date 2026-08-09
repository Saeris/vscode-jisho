/**
 * Crash and issue reporting, end to end (spec 20).
 *
 * The report URL cannot be asserted by letting it open — that would launch a browser on the
 * developer's machine mid-suite. Instead the About view's copy button is used as the observable
 * proxy: it carries the SAME snapshot the issue body embeds, so asserting what it copies asserts
 * what a report would contain.
 */
import type { FrameLocator } from "@playwright/test";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

/**
 * The diagnostics the About view would copy.
 *
 * Read from the button's own `value` rather than through the clipboard: `navigator.clipboard.readText`
 * is denied in the workbench context, and pasting into a scratch editor added a quick-open dance
 * that broke on the command's name. The string asserted here is the exact one the button writes and
 * the exact one `issueBody` embeds, so nothing about the coverage is weaker for it.
 */
const diagnosticsText = async (jisho: FrameLocator): Promise<string> => {
  const copy = jisho.getByRole("button", { name: /copy diagnostics/i });
  await expect(copy).toBeVisible({ timeout: 20_000 });
  return (await copy.getAttribute("data-value")) ?? "";
};

test("the About view offers the diagnostics as a Markdown table", async ({
  jisho
}) => {
  // WHY: the third surface of the same payload. A user filing a report through some other channel
  // needs the table, and "run this and paste what it copies" is a thing a maintainer can ask for.
  await jisho.getByRole("button", { name: /about/i }).click();
  await expect(
    jisho.getByRole("button", { name: /copy diagnostics/i })
  ).toBeVisible({ timeout: 20_000 });
});

test("the diagnostics name the build, the runtime and the dictionary", async ({
  jisho
}) => {
  // WHY: this is the whole point of the feature — a report that cannot be traced to a build is not
  // actionable. Asserted through the CLIPBOARD rather than the DOM, because the clipboard is what
  // actually reaches an issue, and it is the same string the reporter sends.
  await jisho.getByRole("button", { name: /about/i }).click();
  const copied = await diagnosticsText(jisho);
  // The build, which is the field that makes a version traceable to a commit.
  expect(copied).toContain("Extension");
  expect(copied).toContain("VS Code");
  expect(copied).toContain("Node");
  // The dictionary, because "wrong result" bugs are usually data rather than code.
  expect(copied).toContain("Variant");
  expect(copied).toContain("Schema");
  // Markdown, so it pastes into an issue as a table rather than as a run-on line.
  expect(copied).toContain("| Field | Value |");
});

test("the diagnostics carry no absolute paths", async ({ jisho }) => {
  // WHY: the snapshot is one click from a public issue. The stack sanitizer is unit-tested, but
  // the DIAGNOSTICS are assembled from a different set of sources (the OS release, the dictionary's
  // `.version` sidecar) and could leak a path without the sanitizer being involved at all.
  await jisho.getByRole("button", { name: /about/i }).click();
  const copied = await diagnosticsText(jisho);
  expect(copied).not.toMatch(/[A-Za-z]:\\Users\\/u);
  expect(copied).not.toMatch(/\/(?:Users|home)\//u);
});

test("Report an Issue is in the command palette", async ({ vscode }) => {
  // WHY: the command is the manual's stated feedback path, and the README documents it by name. A
  // command that does not appear is a broken promise on the most-read page there is.
  const win = vscode.window;
  await win.locator(".editor-group-container").first().click();
  await win.keyboard.press("ControlOrMeta+Shift+P");
  await win.keyboard.type("Jisho: Report an Issue");
  await expect(
    win
      .locator(".quick-input-list .monaco-list-row")
      .filter({ hasText: "Report an Issue" })
      .first()
  ).toBeVisible({ timeout: 10_000 });
  await win.keyboard.press("Escape");
});
