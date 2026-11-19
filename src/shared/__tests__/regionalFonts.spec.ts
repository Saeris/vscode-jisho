import { describe, expect, it } from "vite-plus/test";
import { OLD_COLUMN, fontRegionOf, type FontedGroup } from "../regionalFonts";

const CN = 0;
const HK = 1;
const TW = 2;
const JP = 3;

// Groups as phase 1 builds them.
const learn: FontedGroup = {
  chars: ["学", "學", "學", "学"],
  old: "學",
  glyphSig: "01101",
  cpSig: "0110"
};
const have: FontedGroup = {
  chars: ["有", "有", "有", "有"],
  glyphSig: "0010",
  cpSig: "0000"
};

describe("which region's font draws a form", () => {
  it("shares one font between regions that write the same glyph", () => {
    // WHY: 有 is one glyph in China, Hong Kong and Japan, so one font draws all three; the cells the
    // chart calls identical then cannot differ, and the other fonts need not carry 有 at all.
    expect(
      [CN, HK, TW, JP].map((region) => fontRegionOf(have, region))
    ).toEqual([CN, CN, TW, CN]);
  });

  it("does not share across code points, even with the same glyph", () => {
    // WHY: a compatibility ideograph can map to the same glyph as its base character, but a font
    // borrowed for it may lack the code point and draw nothing.
    const twoCodePoints: FontedGroup = {
      chars: ["館", "館", "館", "舘"],
      glyphSig: "0000",
      cpSig: "0001"
    };
    expect(fontRegionOf(twoCodePoints, JP)).toBe(JP);
  });

  it("draws Japan's old form with the font of the region whose glyph it shares", () => {
    // WHY: 學 before Japan's reform is Hong Kong's and Taiwan's glyph; drawn from Japan's font it
    // could differ from them in the details, while the chart says it is the same.
    expect(fontRegionOf(learn, HK)).toBe(HK);
    expect(fontRegionOf(learn, TW)).toBe(HK);
    expect(fontRegionOf(learn, JP)).toBe(CN);
    expect(fontRegionOf(learn, OLD_COLUMN)).toBe(HK);
  });

  it("draws an old form no region writes with Japan's font", () => {
    // WHY: the signature measured the old form in Japan's character map, so Japan's font draws the
    // glyph the chart describes.
    const truth: FontedGroup = {
      chars: ["真", "真", "真", "真"],
      old: "眞",
      glyphSig: "01023",
      cpSig: "0000"
    };
    expect(fontRegionOf(truth, OLD_COLUMN)).toBe(JP);
  });
});
