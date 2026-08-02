/**
 * Applies host-pushed settings to the webview. Everything lands as a CSS variable on the root, so
 * the stylesheet stays the single owner of appearance — components never read settings directly.
 */
import type { HostSettings } from "../shared/messages";

export const applySettings = (settings: HostSettings["settings"]): void => {
  const root = document.documentElement.style;
  root.setProperty("--jisho-text-scale", String(settings.textScale));
  // Selects the part-of-speech palette. An ATTRIBUTE rather than a variable, because the palette
  // is a whole set of custom properties defined per-variant in posPalette.css — swapping this one
  // attribute swaps all nine colours at once. It goes on <body>, the same element VS Code puts its
  // `vscode-light`/`vscode-dark` class on, so light/dark follows the theme with no JS.
  document.body.dataset.jishoPalette = settings.palette;
  // The player's guide-offset dial (registered @property): 1 = arrows clear of the stroke,
  // 0 = arrows tracing it. Set at the root, it inherits into every stroke canvas.
  root.setProperty(
    "--guide-offset",
    settings.guideStyle === "aligned" ? "0" : "1"
  );
};
