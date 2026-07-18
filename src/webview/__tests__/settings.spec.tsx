// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applySettings } from "../settings";

describe("applySettings", () => {
  it("lands every setting as a root CSS variable", () => {
    // WHY: the stylesheet is the single owner of appearance — settings must flow through CSS
    // variables so no component ever reads configuration directly.
    applySettings({ textScale: 1.5, guideStyle: "aligned" });
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--jisho-text-scale")).toBe("1.5");
    // aligned → the player's guide-offset dial goes to 0 (arrows trace the stroke).
    expect(root.getPropertyValue("--guide-offset")).toBe("0");
    applySettings({ textScale: 1.08, guideStyle: "offset" });
    expect(root.getPropertyValue("--guide-offset")).toBe("1");
  });
});
