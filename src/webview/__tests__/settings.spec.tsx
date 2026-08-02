import { describe, expect, it } from "vitest";
import { applySettings } from "../settings";

describe("applySettings", () => {
  it("lands every setting as a root CSS variable", () => {
    // WHY: the stylesheet is the single owner of appearance — settings must flow through CSS
    // variables so no component ever reads configuration directly.
    applySettings({
      textScale: 1.5,
      guideStyle: "aligned",
      palette: "standard"
    });
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--jisho-text-scale")).toBe("1.5");
    // aligned → the player's guide-offset dial goes to 0 (arrows trace the stroke).
    expect(root.getPropertyValue("--guide-offset")).toBe("0");
    applySettings({
      textScale: 1.08,
      guideStyle: "offset",
      palette: "standard"
    });
    expect(root.getPropertyValue("--guide-offset")).toBe("1");
  });

  it("selects the part-of-speech palette on <body>, not the root", () => {
    // WHY: the palette is a whole SET of custom properties defined per-variant in posPalette.css,
    // so it is chosen by an attribute rather than a variable. It has to land on <body> because
    // that is the element VS Code puts its `vscode-light`/`vscode-dark` class on — the light/dark
    // half of the selector and the palette half must match the same element.
    applySettings({
      textScale: 1,
      guideStyle: "offset",
      palette: "deuteranopia"
    });
    expect(document.body.dataset.jishoPalette).toBe("deuteranopia");

    applySettings({ textScale: 1, guideStyle: "offset", palette: "standard" });
    expect(document.body.dataset.jishoPalette).toBe("standard");
  });
});
