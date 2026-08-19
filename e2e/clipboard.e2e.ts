import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import {
  fillSearch,
  jishoFrame,
  openJishoSidebar,
  searchText
} from "./webview";

/**
 * The webview facts the paste fix rests on (#7).
 *
 * `webviewShortcuts.ts` reads the clipboard through `navigator.clipboard` because VS Code's own
 * paste path depends on `execCommand('paste')`, which Electron removed. That choice is only correct
 * while three things hold in a REAL webview: the API exists, the host frame grants the permission,
 * and a read inside a user gesture is allowed. None of them is guaranteed by our code, and all
 * three are invisible to a unit test — so they are asserted here rather than assumed in a comment.
 *
 * If VS Code finishes microsoft/vscode#239228 and tightens the iframe's `allow` list, this fails
 * with a clear reason instead of paste quietly breaking again in the field.
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

test("the webview may read the clipboard", async () => {
  const frame = await jishoFrame(vscode!.window);
  const box = frame.getByRole("searchbox");
  await box.click();

  const capability = await box.evaluate(async () => ({
    // `in`, not an optional chain: the types promise `clipboard` is always there, and the point of
    // this assertion is that the RUNTIME agrees.
    hasReadText:
      "clipboard" in navigator &&
      typeof navigator.clipboard.readText === "function",
    isSecureContext: window.isSecureContext,
    // `clipboard-read` is a real permission name that TypeScript's `PermissionName` union does not
    // list, so the cast asserts what the browser accepts rather than what the DOM lib describes.
    permission: await navigator.permissions
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      .query({ name: "clipboard-read" as PermissionName })
      .then((p) => p.state)
      .catch((e: unknown) => `query threw: ${String(e)}`)
  }));

  // `granted`, not `prompt`: a webview cannot show a permission dialog, so anything other than an
  // outright grant means the read fails with nothing the user can do about it.
  expect(capability).toEqual({
    hasReadText: true,
    isSecureContext: true,
    permission: "granted"
  });
});

test("pasting into the search box inserts the clipboard exactly once", async () => {
  // WHY (#7): the reporter's paste did nothing on macOS.
  //
  // Stated plainly, because it was checked: this test passes with the paste chord disabled, since
  // the native paste still works on a Windows or Linux runner. It cannot prove the macOS fix. What
  // it DOES prove is the risk the fix introduces everywhere else — our handler suppresses the
  // default and re-inserts, so if both ran the clipboard would land twice.
  const win = vscode!.window;
  const frame = await jishoFrame(win);
  const phrase = "水を飲む";

  // Through a real editor, since the webview may not write the clipboard itself.
  await win
    .locator(".editor-group-container")
    .first()
    .click({ position: { x: 200, y: 200 } });
  await win.keyboard.press("ControlOrMeta+n");
  await win.locator(".editor-group-container .monaco-editor").first().waitFor();
  await win.keyboard.type(phrase);
  await win.keyboard.press("ControlOrMeta+a");
  await win.keyboard.press("ControlOrMeta+c");

  await fillSearch(frame, "");
  const box = frame.getByRole("searchbox");
  await box.click();
  await box.press("ControlOrMeta+v");

  await expect(async () => {
    expect(await searchText(frame)).toBe(phrase);
  }).toPass({ timeout: 5000 });
});

test("paste replaces the selection rather than appending to it", async () => {
  // WHY: the insert is re-delivered as a synthetic `beforeinput`, and the field decides what range
  // it covers. Getting that wrong would append to a query the user meant to overwrite — the exact
  // gesture the Select All fix (#4) exists to enable, so the two features meet here.
  const win = vscode!.window;
  const frame = await jishoFrame(win);

  await fillSearch(frame, "食べる");
  const box = frame.getByRole("searchbox");
  await box.click();
  await box.press("ControlOrMeta+a");
  await box.press("ControlOrMeta+v");

  await expect(async () => {
    expect(await searchText(frame)).toBe("水を飲む");
  }).toPass({ timeout: 5000 });
});
