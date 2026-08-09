/**
 * Rasterize the Marketplace icon from `media/jisho.svg`.
 *
 * The Marketplace requires a PNG — an SVG `icon` is rejected — at 128x128 or larger. The source is a
 * monochrome `currentColor` glyph sized for the activity bar, so it needs a colour and a backdrop
 * before it works as a product icon: on its own it would render as a black-on-transparent mark that
 * disappears against VS Code's dark extension list.
 *
 * Rendered through Playwright's Chromium rather than a rasterizer dependency. The E2E harness
 * already installs that browser, so this adds nothing to the dependency tree for a file that is
 * regenerated roughly never.
 *
 * Run with `vp run build:icon`.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Matches the activity-bar glyph's own proportions; 128 is the Marketplace's documented minimum. */
const SIZE = 128;
/** Dark enough to carry a white glyph on the Marketplace's light listing page. */
const BACKGROUND = "#1e293b";
const FOREGROUND = "#ffffff";

const main = async (): Promise<void> => {
  const root = process.cwd();
  const svg = readFileSync(join(root, "media", "jisho.svg"), "utf8");

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1
  });
  await page.setContent(
    `<!doctype html>
     <style>
       html, body { margin: 0; padding: 0; }
       body {
         width: ${SIZE}px; height: ${SIZE}px;
         display: grid; place-items: center;
         background: ${BACKGROUND};
         color: ${FOREGROUND};
       }
       /* The glyph is inset rather than bled to the edges: VS Code and the Marketplace both round
          the icon's corners, and a mark that runs to the edge loses its extremities to that. */
       svg { width: ${Math.round(SIZE * 0.68)}px; height: auto; display: block; }
     </style>
     ${svg}`,
    { waitUntil: "load" }
  );
  const png = await page.screenshot({ omitBackground: false });
  await browser.close();

  const out = join(root, "media", "icon.png");
  writeFileSync(out, png);
  console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
};

await main();
