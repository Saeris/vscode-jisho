import { describe, expect, it } from "vite-plus/test";
import type { RegionalGroupDto } from "../../shared/messages";
import {
  regionalDrawings,
  type Drawing,
  type StrokeManifest
} from "../regionalStrokes";

// As the built database returns them.
const learn: RegionalGroupDto = {
  key: "學",
  chars: ["学", "學", "學", "学"],
  old: "學",
  glyphSig: "01101",
  cpSig: "0110",
  strokes: [8, 16, 16, 8, 16],
  tiers: [1, 1, 1, 2],
  readings: [null, null, null, null],
  ranks: [null, null, null, null]
};
const back: RegionalGroupDto = {
  key: "返",
  chars: ["返", "返", "返", "返"],
  glyphSig: "0123",
  cpSig: "0000",
  strokes: [7, 7, 8, 7],
  tiers: [1, 1, 1, 2],
  readings: [null, null, null, null],
  ranks: [null, null, null, null]
};

/** A file reader over a fixed set of drawings: `set:char` names each file that exists. */
const files =
  (...present: string[]) =>
  async ({ set, char }: Drawing): Promise<string | null> =>
    present.includes(`${set}:${char}`) ? `<svg>${set}:${char}</svg>` : null;

const summary = (
  drawings: Awaited<ReturnType<typeof regionalDrawings>>
): [number[], string | null][] =>
  drawings.map((drawing) => [drawing.columns, drawing.svg]);

describe("stroke order by region", () => {
  it("shares one drawing among regions with the same strokes, and lends Hong Kong Taiwan's", async () => {
    // WHY: China writes 学 as Japan does, stroke for stroke, so one drawing serves both; Hong Kong
    // has no set and writes Taiwan's glyph, and Japan's old form is that same 學.
    const manifest: StrokeManifest = { cn: { 学: "ja" }, tw: { 學: "hant" } };
    expect(
      summary(
        await regionalDrawings(learn, manifest, files("ja:学", "hant:學"))
      )
    ).toEqual([
      [[0, 3], "<svg>ja:学</svg>"],
      [[1, 2, 4], "<svg>hant:學</svg>"]
    ]);
  });

  it("says a form has no drawing instead of showing another region's order", async () => {
    // WHY: Taiwan's and Hong Kong's 返 are their own glyphs; drawing them with China's or Japan's
    // order would hide the very difference the reader is checking.
    const manifest: StrokeManifest = { cn: { 返: "hans" }, tw: {} };
    const drawings = await regionalDrawings(
      back,
      manifest,
      files("ja:返", "hans:返")
    );
    expect(summary(drawings)).toEqual([
      [[3], "<svg>ja:返</svg>"],
      [[0], "<svg>hans:返</svg>"],
      [[1, 2], null]
    ]);
  });

  it("treats a drawing whose file is missing as no drawing", async () => {
    // WHY: the manifest and the files ship together, but if one were lost the view must say there
    // is no drawing, not render an empty player.
    const manifest: StrokeManifest = { cn: { 学: "ja" }, tw: { 學: "hant" } };
    const drawings = await regionalDrawings(learn, manifest, files("ja:学"));
    expect(summary(drawings)).toEqual([
      [[0, 3], "<svg>ja:学</svg>"],
      [[1, 2, 4], null]
    ]);
  });

  it("falls back to Japan's own drawing of the old form when the borrowed one is missing", async () => {
    // WHY: Japan's old form 學 borrows Taiwan's drawing; if that file were lost, Japan's drawing of
    // the character 學 is still the right one to show, not nothing and not 学's.
    const manifest: StrokeManifest = { cn: { 学: "ja" }, tw: { 學: "hant" } };
    const drawings = await regionalDrawings(
      learn,
      manifest,
      files("ja:学", "ja:學")
    );
    expect(summary(drawings)).toEqual([
      [[0, 3], "<svg>ja:学</svg>"],
      [[1, 2], null],
      [[4], "<svg>ja:學</svg>"]
    ]);
  });
});
