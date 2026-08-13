import { describe, expect, it } from "vitest";
import { strokeSvgName } from "../strokeSvgName";

describe("stroke svg filename", () => {
  it("names a file by its decimal codepoint", () => {
    // WHY: the number is what upstream AnimCJK serves, so the build's output name and its source
    // name are the same string — one fewer mapping to get wrong.
    expect(strokeSvgName("あ")).toBe("12354");
    expect(strokeSvgName("水")).toBe("27700");
  });

  it("produces a pure-ASCII name for every character", () => {
    // WHY: this is the whole point. A filename carrying the character itself broke in two
    // environments that Windows and Linux cannot reproduce — macOS reported every kana drawing as
    // modified after a clone, and the Marketplace rejected the upload for a duplicate dictionary
    // key. Digits cannot collide under any normalization, case fold or filesystem encoding.
    for (const literal of ["あ", "ガ", "パ", "水", "髙", "𠮟"]) {
      const name = strokeSvgName(literal);
      expect(name).toMatch(/^[0-9]+$/u);
    }
  });

  it("distinguishes characters that fold together elsewhere", () => {
    // WHY: ハ/パ and は/ば are the pairs the Marketplace collapsed. Their codepoints differ, so the
    // names differ — which is the property that makes this fix work rather than merely rename.
    expect(strokeSvgName("ハ")).not.toBe(strokeSvgName("パ"));
    expect(strokeSvgName("は")).not.toBe(strokeSvgName("ば"));
  });

  it("refuses anything that is not a single character", () => {
    // WHY: a digraph (きゃ) has no drawing, and the host uses this result to decide whether to touch
    // the filesystem at all. Returning a name for two characters would turn a known-absent file into
    // a probe on every render.
    expect(strokeSvgName("きゃ")).toBeUndefined();
    expect(strokeSvgName("")).toBeUndefined();
  });

  it("handles a surrogate pair as one character", () => {
    // WHY: 𠮟 is outside the BMP, so `.length` is 2 while `Array.from` sees one character. A
    // length-based guard would reject a character that does have a drawing.
    expect(strokeSvgName("𠮟")).toBe("134047");
  });
});
