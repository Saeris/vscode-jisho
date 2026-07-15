import { describe, expect, it } from "vitest";
import { euclid, extractFeatures, momentNormalize } from "../geometry";
import type { Pattern, Point } from "../types";

describe("euclid", () => {
  it("computes straight-line distance between two points", () => {
    // WHY: the 3-4-5 triangle is the canonical hand-checkable case; extractFeatures walks arc
    // length via euclid, so an error here shifts every resampled point.
    expect(euclid([0, 0], [3, 4])).toBe(5);
    expect(euclid([1, 1], [1, 1])).toBe(0);
  });
});

describe("momentNormalize", () => {
  it("centres and scales a pattern into the 256×256 box", () => {
    // WHY: recognition is size/position invariant only because input is normalized to the same box
    // the reference patterns were extracted in. A symmetric square should land centred with real,
    // finite coordinates inside [0,256]-ish — the exact values depend on the moment math, so we
    // assert the invariants (finite, centred-ish) rather than magic numbers.
    const square: Pattern = [
      [
        [10, 10],
        [110, 10],
        [110, 110],
        [10, 110],
        [10, 10]
      ]
    ];
    const out = momentNormalize(square);
    const points = out.flat();
    for (const [x, y] of points) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    // Centroid should sit near the box centre (128) after normalization.
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
    expect(cx).toBeGreaterThan(96);
    expect(cx).toBeLessThan(160);
    expect(cy).toBeGreaterThan(96);
    expect(cy).toBeLessThan(160);
  });

  it("is translation invariant", () => {
    // WHY: the same shape drawn in a different corner of the canvas must normalize identically —
    // that's the whole point of centring on the centroid.
    const shape: Pattern = [
      [
        [0, 0],
        [40, 0],
        [40, 40]
      ]
    ];
    const shifted: Pattern = shape.map((s) =>
      s.map(([x, y]): [number, number] => [x + 200, y + 150])
    );
    const a = momentNormalize(shape).flat();
    const b = momentNormalize(shifted).flat();
    for (let i = 0; i < a.length; i++) {
      expect(a[i][0]).toBeCloseTo(b[i][0], 5);
      expect(a[i][1]).toBeCloseTo(b[i][1], 5);
    }
  });
});

describe("extractFeatures", () => {
  it("keeps the first and last point of a stroke", () => {
    // WHY: the endpoint metrics rely on first/last points existing; resampling must never drop them.
    const stroke: Pattern = [
      [
        [0, 0],
        [100, 0]
      ]
    ];
    const out = extractFeatures(stroke, 20);
    expect(out[0][0]).toEqual([0, 0]);
    expect(out[0][out[0].length - 1]).toEqual([100, 0]);
  });

  it("resamples a long stroke to roughly interval-spaced points", () => {
    // WHY: a 100-unit horizontal stroke at interval 20 should yield ~6 points (0,20,40,60,80,100),
    // spacing the distance metrics rely on. Dense input, regular output.
    const dense: Point[] = [];
    for (let x = 0; x <= 100; x++) dense.push([x, 0]);
    const out = extractFeatures([dense], 20);
    expect(out[0].length).toBeGreaterThanOrEqual(5);
    expect(out[0].length).toBeLessThanOrEqual(7);
  });

  it("keeps a single-point stroke as two identical points", () => {
    // WHY: the reference always emits at least two points per stroke (adds the last if only one
    // was kept); the distance metrics index [0] and [len-1], so a lone point must be duplicated.
    const out = extractFeatures([[[50, 50]]], 20);
    expect(out[0]).toEqual([
      [50, 50],
      [50, 50]
    ]);
  });
});
