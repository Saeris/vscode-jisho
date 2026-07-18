/**
 * Applies host-pushed settings to the webview. Everything lands as a CSS variable on the root, so
 * the stylesheet stays the single owner of appearance — components never read settings directly.
 */
import type { HostSettings } from "../shared/messages";

export const applySettings = (settings: HostSettings["settings"]): void => {
  const root = document.documentElement.style;
  root.setProperty("--jisho-text-scale", String(settings.textScale));
  // The player's guide-offset dial (registered @property): 1 = arrows clear of the stroke,
  // 0 = arrows tracing it. Set at the root, it inherits into every stroke canvas.
  root.setProperty(
    "--guide-offset",
    settings.guideStyle === "aligned" ? "0" : "1"
  );
};
