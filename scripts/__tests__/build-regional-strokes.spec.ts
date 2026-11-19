import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { RegionalGroup } from "../regional";
import {
  sameOrder,
  strokeManifest,
  type StrokeManifest
} from "../build-regional-strokes";

type Median = [number, number][];

// Two strokes of a 1024-unit drawing: a horizontal and a vertical.
const across: Median = [
  [200, 500],
  [800, 500]
];
const down: Median = [
  [500, 200],
  [500, 800]
];
const nudged = (median: Median): Median =>
  median.map(([x, y]) => [x + 40, y - 30]);

const group = (
  chars: [string, string, string, string],
  glyphSig: string,
  cpSig: string
): RegionalGroup => ({
  key: chars[3],
  chars,
  glyphSig,
  cpSig,
  tiers: [1, 1, 1, 1]
});

describe("comparing stroke order", () => {
  it("counts two drawings of the same strokes in the same order as one order", () => {
    // WHY: AnimCJK draws each language separately, so no two drawings match exactly; a small
    // shift is the same stroke, and treating it as different would ship a duplicate drawing.
    expect(sameOrder([across, down], [nudged(across), nudged(down)])).toBe(
      true
    );
  });

  it("tells the same strokes in another order apart", () => {
    // WHY: this is the difference the feature exists for (China writes 右 in another order than
    // Japan). Missing it would show Japan's order as China's.
    expect(sameOrder([across, down], [down, across])).toBe(false);
    expect(sameOrder([across, down], [across])).toBe(false);
    expect(sameOrder([across], undefined)).toBe(false);
  });
});

describe("which set draws each region's form", () => {
  const medians = {
    ja: new Map([
      ["右", [down, across]],
      ["学", [across, down]]
    ]),
    hans: new Map([
      ["右", [across, down]],
      ["学", [nudged(across), nudged(down)]],
      ["发", [down]]
    ]),
    hant: new Map([
      ["右", [nudged(across), nudged(down)]],
      ["學", [down, down]],
      ["髮", [across]]
    ])
  };
  const manifest = (groups: RegionalGroup[]): StrokeManifest =>
    strokeManifest(groups, medians, () => true);

  it("shares Japan's drawing only for the same glyph in the same order", () => {
    // WHY: "China and Japan" as one drawing is a claim about stroke order, not only shape: 右 is
    // one glyph in both, drawn in two orders, so China needs its own drawing.
    expect(
      manifest([group(["学", "學", "學", "学"], "0110", "0110")]).cn["学"]
    ).toBe("ja");
    expect(
      manifest([group(["右", "右", "右", "右"], "0000", "0000")]).cn["右"]
    ).toBe("hans");
  });

  it("lets Taiwan share China's drawing when glyph and order match", () => {
    // WHY: Taiwan's set is small; sharing China's drawing where it is truly the same keeps the
    // package small without claiming a sameness that is not there.
    const { tw } = manifest([group(["右", "右", "右", "右"], "0000", "0000")]);
    expect(tw["右"]).toBe("hans");
  });

  it("gives a form its own drawing when its glyph differs", () => {
    // WHY: 學 is a different shape from Japan's 学; borrowing would draw the wrong character.
    const { cn, tw } = manifest([
      group(["学", "學", "學", "学"], "0110", "0110")
    ]);
    expect(tw["學"]).toBe("hant");
    expect(cn["学"]).toBe("ja");
  });

  it("does not let a region share a drawing Japan does not have", () => {
    // WHY: with no Japanese drawing there is nothing to share; claiming "same as Japan" would
    // leave China's form drawn from a file that does not exist.
    const { cn } = strokeManifest(
      [group(["学", "學", "學", "学"], "0110", "0110")],
      medians,
      () => false
    );
    expect(cn["学"]).toBe("hans");
  });
});

describe("the committed manifest", () => {
  const committed: StrokeManifest = JSON.parse(
    readFileSync(join(process.cwd(), "assets", "regional-strokes.json"), "utf8")
  );

  it("records the known regional differences in stroke order", () => {
    // WHY: Japan writes 右 and 有 with the left-falling stroke first, China with the horizontal;
    // if the comparison lost that, every jōyō kanji would claim Japan's order everywhere.
    expect(committed.cn["右"]).toBe("hans");
    expect(committed.cn["有"]).toBe("hans");
    // And where China does write as Japan does, it shares the drawing (学, 人).
    expect(committed.cn["学"]).toBe("ja");
    expect(committed.cn["人"]).toBe("ja");
    // Taiwan's own drawing of 學, which phase 4's view must play.
    expect(committed.tw["學"]).toBe("hant");
  });
});
