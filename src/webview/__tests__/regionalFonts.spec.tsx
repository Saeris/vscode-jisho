import { describe, expect, it } from "vite-plus/test";
import {
  OLD_COLUMN,
  REGIONAL_FONT_FAMILIES,
  fontRegionOf,
  type FontedGroup
} from "../../shared/regionalFonts";
import "../styles/regionalFonts.css";

// Groups as the phase 1 build writes them (the database tests in scripts/__tests__/regional.spec.ts
// check the same values against a built database).
const GROUPS: Record<string, FontedGroup> = {
  晚: {
    chars: ["晚", "晚", "晚", "晩"],
    old: "晚",
    glyphSig: "00010",
    cpSig: "0001"
  },
  返: { chars: ["返", "返", "返", "返"], glyphSig: "0123", cpSig: "0000" },
  有: { chars: ["有", "有", "有", "有"], glyphSig: "0010", cpSig: "0000" },
  學: {
    chars: ["学", "學", "學", "学"],
    old: "學",
    glyphSig: "01101",
    cpSig: "0110"
  },
  一: { chars: ["一", "一", "一", "一"], glyphSig: "0000", cpSig: "0000" }
};

const columnsOf = (group: FontedGroup): number[] =>
  group.old === undefined ? [0, 1, 2, 3] : [0, 1, 2, 3, OLD_COLUMN];
const charOf = (group: FontedGroup, column: number): string =>
  (column === OLD_COLUMN ? group.old : group.chars[column]) ?? "";
const familyOf = (group: FontedGroup, column: number): string =>
  REGIONAL_FONT_FAMILIES[fontRegionOf(group, column)] ?? "";

/** The pixels of one character drawn in one family, once that family's chunk has loaded. */
const draw = async (family: string, char: string): Promise<string> => {
  const font = `64px "${family}"`;
  await document.fonts.load(font, char);
  const canvas = new OffscreenCanvas(80, 80);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.font = font;
  context.fillText(char, 8, 66);
  return [...context.getImageData(0, 0, 80, 80).data].join(",");
};

describe("the bundled region fonts", () => {
  it("cover every form of the phase 1 test characters in the font chosen for it", async () => {
    // WHY: a form its font does not carry falls back to some other font on the reader's machine,
    // and the comparison then shows that font's glyph as the region's.
    const missing: string[] = [];
    for (const group of Object.values(GROUPS))
      for (const column of columnsOf(group)) {
        const family = familyOf(group, column);
        const char = charOf(group, column);
        const loaded = await document.fonts.load(`64px "${family}"`, char);
        if (!loaded.some((face) => face.family === family))
          missing.push(`${char} in ${family}`);
      }
    expect(missing).toEqual([]);
  });

  it("draw 返 four ways, one per region", async () => {
    // WHY: 返 is one code point that each region draws differently; only the right font for each
    // region shows the difference the view exists to point out.
    const group = GROUPS["返"];
    const shapes = await Promise.all(
      [0, 1, 2, 3].map(async (column) => draw(familyOf(group, column), "返"))
    );
    expect(new Set(shapes).size).toBe(4);
  });

  it("draw 有 differently in Taiwan, and alike elsewhere", async () => {
    // WHY: Taiwan alone differs, by glyph only. If Taiwan's font drew China's shape, the view would
    // claim a difference the reader cannot see.
    const group = GROUPS["有"];
    const [china, hongKong, taiwan, japan] = await Promise.all(
      [0, 1, 2, 3].map(async (column) => draw(familyOf(group, column), "有"))
    );
    expect(taiwan).not.toBe(china);
    expect(hongKong).toBe(china);
    expect(japan).toBe(china);
  });
});
