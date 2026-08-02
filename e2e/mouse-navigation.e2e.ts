import { expect, test } from "@playwright/test";
import { launchVSCode, type Launched } from "./launch";
import { jishoFrame, openJishoSidebar } from "./webview";

/**
 * Back/forward mouse buttons (BACKLOG #48).
 *
 * The unit tests prove the machine's forward stack; this proves the buttons actually REACH it.
 * Playwright's mouse API cannot synthesise X1/X2, so the events are dispatched over CDP — which is
 * also how the webview was verified to receive them at all (the backlog flagged that VS Code might
 * swallow them; it does not).
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

test("X1 goes back and X2 goes forward", async () => {
  const win = vscode!.window;
  const frame = await jishoFrame(win);
  const cdp = await win.context().newCDPSession(win);
  /** Click a non-primary mouse button over the sidebar. */
  const auxClick = async (button: "back" | "forward"): Promise<void> => {
    for (const type of ["mousePressed", "mouseReleased"] as const) {
      await cdp.send("Input.dispatchMouseEvent", {
        type,
        x: 150,
        y: 300,
        button,
        buttons: 0,
        clickCount: 1
      });
    }
  };

  // Drill into a word so there is history to traverse.
  await frame.getByRole("searchbox").fill("食べる");
  await frame
    .getByRole("option", { name: /食べる/ })
    .first()
    .click();
  await expect(frame.getByRole("button", { name: /back/i })).toBeVisible();

  // X1 → back to the search view.
  await auxClick("back");
  await expect(frame.getByRole("searchbox")).toBeVisible();
  await expect(frame.getByRole("button", { name: /back/i })).toHaveCount(0);

  // X2 → forward into the word again. This is the half that did not exist before #48: the machine
  // discarded popped views, so there was nothing to return to.
  await auxClick("forward");
  await expect(frame.getByRole("button", { name: /back/i })).toBeVisible();
});
