import { expect, test } from "../fixtures";
import { openKanjiResult, returnToSearch, screenshotSidebar } from "../webview";

/**
 * Regional forms (spec 22, phase 3) in VS Code, in a dark and a light theme: the kanji page's
 * summary for 学, the overprint, and the forms set side by side with their regions named.
 *
 * Also the one place that proves the region fonts load from the packaged layout: component tests
 * run on Vite's dev server, which serves a wrong font URL too (spec 22, phase 2).
 *
 * Switches the theme, so it restores dark afterwards: the instance is shared across files.
 */
test.describe.configure({ mode: "serial" });

test.afterAll(async ({ vscode }) => {
  await vscode.setTheme("dark");
});

for (const theme of ["dark", "light"] as const) {
  test(`regional forms of 学, ${theme} theme`, async ({ vscode, jisho }) => {
    await vscode.setTheme(theme);
    await openKanjiResult(jisho, "学");

    const summary = jisho.getByRole("button", {
      name: /Written differently in Hong Kong and Taiwan · 2 forms · old form 學/u
    });
    await expect(summary).toBeVisible();
    await screenshotSidebar(
      vscode.window,
      `test-results/shots/30-regional-summary-${theme}.png`
    );

    await summary.click();
    const overprint = jisho.getByRole("img", {
      name: "Overlaid: 学 (China and Japan), 學 (Hong Kong, Taiwan and Japan's old form)"
    });
    await expect(overprint).toBeVisible();
    // The forms are drawn in the bundled region fonts, not a system fallback.
    const loaded = await overprint.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts]
        .filter((face) => face.status === "loaded")
        .map((face) => face.family.replaceAll('"', ""));
    });
    expect(loaded).toEqual(
      expect.arrayContaining(["Jisho Sans SC", "Jisho Sans HK"])
    );
    await screenshotSidebar(
      vscode.window,
      `test-results/shots/31-regional-overprint-${theme}.png`
    );

    await jisho.getByRole("radio", { name: "Separate" }).click();
    const separate = jisho.getByRole("img", { name: /^Side by side/u });
    await expect(separate).toContainText(
      "學Hong Kong, Taiwan and Japan's old form"
    );
    await screenshotSidebar(
      vscode.window,
      `test-results/shots/32-regional-separate-${theme}.png`
    );
  });
}

test("capture: 返, one code point drawn four ways, fanned under the pointer", async ({
  vscode,
  jisho
}) => {
  await openKanjiResult(jisho, "返");
  await jisho
    .getByRole("button", {
      name: /Written differently in China, Hong Kong and Taiwan · 4 forms/u
    })
    .click();
  const overprint = jisho.getByRole("img", {
    name: /^Overlaid: 返 \(Japan\)/u
  });
  await overprint.hover();
  // Resting the pointer fans the layers and lights each form in turn, naming it below. Every
  // caption is always in the page; the lit one is the one shown.
  await expect(jisho.getByText("返 · Japan", { exact: true })).toHaveCSS(
    "opacity",
    "1"
  );
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/33-regional-four-forms.png"
  );
});

test("stroke order by region: 学 for China and Japan, 學 for Taiwan, none for Taiwan's 返", async ({
  vscode,
  jisho
}) => {
  // Spec 22, phase 4: China writes 学 stroke for stroke as Japan does, so one drawing serves both;
  // 學 has Taiwan's own drawing; and AnimCJK has no Taiwanese 返, which the view must say.
  await openKanjiResult(jisho, "学");
  await jisho.getByRole("button", { name: /stroke order/i }).click();
  await expect(
    jisho.getByRole("radio", { name: "China and Japan" })
  ).toBeChecked();
  await expect(jisho.getByText("8 strokes", { exact: true })).toBeVisible();
  await jisho
    .getByRole("radio", { name: "Hong Kong, Taiwan and Japan's old form" })
    .click();
  await expect(jisho.getByText("16 strokes", { exact: true })).toBeVisible();
  await screenshotSidebar(
    vscode.window,
    "test-results/shots/34-regional-stroke-order.png"
  );

  await returnToSearch(jisho);
  await openKanjiResult(jisho, "返");
  await jisho.getByRole("button", { name: /stroke order/i }).click();
  await jisho.getByRole("radio", { name: "Hong Kong and Taiwan" }).click();
  await expect(
    jisho.getByText(
      "There is no stroke-order drawing for 返 as Hong Kong and Taiwan write it."
    )
  ).toBeVisible();
});

test("readings and frequency of 学: Mandarin, Cantonese, and a labelled rank for each region", async ({
  jisho
}) => {
  // Spec 22, phase 5. Hong Kong's corpus is live, so only its label is asserted, not its number.
  await openKanjiResult(jisho, "学");
  await jisho
    .getByRole("button", {
      name: /Written differently in Hong Kong and Taiwan/u
    })
    .click();
  await expect(jisho.getByText("Readings and frequency")).toBeVisible();
  await expect(jisho.getByText("hok6", { exact: true })).toBeVisible();
  await expect(jisho.getByText("(Cantonese)")).toBeVisible();
  await expect(jisho.getByText("xué", { exact: true }).first()).toBeVisible();
  await expect(jisho.getByText("#66 in modern Chinese texts")).toBeVisible();
  await expect(
    jisho.getByText(/^#\d+ in Cantonese texts \(words\.hk\)$/u)
  ).toBeVisible();
  await expect(
    jisho.getByText("#93 in news and social media (2023)")
  ).toBeVisible();
  await expect(jisho.getByText("#5 on Japanese Wikipedia")).toBeVisible();
});
