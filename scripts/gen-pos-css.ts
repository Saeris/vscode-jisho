/**
 * Generate `src/webview/styles/posPalette.css` from `src/shared/posPalette.ts`.
 *
 * The palette has one source of truth (the TS module, which the host also reads for editor
 * decorations); this emits the webview's CSS custom properties from it so the two surfaces can
 * never drift. Run `vp run build:pos-css` after changing the palette.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PALETTE_CATEGORIES,
  palette,
  posVar,
  type Ground,
  type PaletteId
} from "../src/shared/posPalette.ts";

const IDS: PaletteId[] = [
  "standard",
  "protanopia",
  "deuteranopia",
  "tritanopia"
];

/**
 * One palette as a custom-property block. Each colour is declared TWICE — `rgb()` then `oklch()` —
 * so a renderer that cannot parse `oklch()` discards the second and keeps the first.
 */
const block = (selector: string, id: PaletteId, ground: Ground): string => {
  const p = palette(id, ground);
  const decls = PALETTE_CATEGORIES.flatMap((c) => [
    `  ${posVar(c)}: ${p[c].rgb};`,
    `  ${posVar(c)}: ${p[c].css};`
  ]).join("\n");
  return `${selector} {\n${decls}\n}`;
};

const HEADER = `/*
 * Part-of-speech palette tokens.
 *
 * GENERATED from src/shared/posPalette.ts by scripts/gen-pos-css.ts — do not hand-edit.
 *
 * Never replace the \`oklch()\` values with hex: six of the standard palette's colours sit outside
 * sRGB deliberately, and hex quantises to 8 bits per channel and clamps them
 * (docs/pos-palette-research.md).
 *
 * The palette is selected by a \`data-jisho-palette\` attribute set from the user's setting.
 * Light/dark follows VS Code's own body class, so it tracks theme changes with no JS.
 */
`;

const css =
  HEADER +
  IDS.map((id) => {
    // The attribute is set on <body>, the same element VS Code puts its theme class on, so both
    // selectors match one element — no `:has()`, no descendant coupling.
    const dark = block(`body[data-jisho-palette="${id}"]`, id, "dark");
    // High-contrast light carries BOTH `vscode-high-contrast` and `vscode-high-contrast-light`,
    // so the light rules must come second — CSS resolves equal specificity by source order.
    const light = block(
      `body.vscode-light[data-jisho-palette="${id}"],\n` +
        `body.vscode-high-contrast-light[data-jisho-palette="${id}"]`,
      id,
      "light"
    );
    return `\n/* ── ${id} ─────────────────────────────────────────────── */\n${dark}\n${light}\n`;
  }).join("");

const out = fileURLToPath(
  new URL("../src/webview/styles/posPalette.css", import.meta.url)
);
writeFileSync(out, css);
console.log(`wrote ${out}`);
