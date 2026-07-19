/**
 * Throughput benchmarks for the handwriting recognizer — the "did my change help?" measurement.
 *
 * This is the companion to `recognize.bench.mjs`, and they answer different questions:
 *   - the .mjs profile → deoptkit → WHY a path is slow (inline caches, deopts, where ticks go)
 *   - this file       → ops/sec + margin of error → WHETHER a change made it faster
 * Only the second can gate a regression, which is what makes it worth having.
 *
 * Run:      vp run bench
 * Baseline: vp run bench:save     (writes bench/baseline.json)
 * Compare:  vp run bench:compare  (diffs against that baseline)
 *
 * Methodology — and why the inputs look like this — is in bench/README.md. The short version: cost
 * is driven by STROKE COUNT (17× across the range, non-monotonic, peaking at 9 strokes where the
 * ±2 candidate window admits 863 of 2,213 patterns), not by how wobbly the strokes are.
 */
import { bench, describe } from "vitest";
import { recognize } from "../src/webview/recognizer/index";
import { refPatterns } from "../src/webview/recognizer/patterns";
import type { Point, Stroke } from "../src/webview/recognizer/types";

const jitter = (strokes: readonly Stroke[], amount: number): Stroke[] =>
  strokes.map((stroke) =>
    stroke.map(
      ([x, y]) =>
        [
          x + (Math.random() - 0.5) * amount,
          y + (Math.random() - 0.5) * amount
        ] as Point
    )
  );

const strokesFor = (char: string): Stroke[] => {
  const entry = refPatterns.find((p) => p[0] === char);
  if (!entry) throw new Error(`no reference pattern for ${char}`);
  return jitter(entry[2] as unknown as Stroke[], 8);
};

/**
 * The interaction the UI actually performs: recognize after every stroke end, over the strokes
 * committed so far. Cached, so the benchmark measures recognition rather than input construction.
 */
const sessionOf = (char: string): Stroke[][] => {
  const drawn = strokesFor(char);
  return drawn.map((_, i) => drawn.slice(0, i + 1));
};

describe("recognize", () => {
  // The headline number: one complete drawing session, which is what a user experiences. A
  // regression here means "drawing a character got slower", which is the claim worth defending.
  const nineStroke = sessionOf("食"); // worst case for the candidate window
  bench("session: draw 食 (9 strokes, worst-case candidate set)", () => {
    for (const prefix of nineStroke) recognize(prefix, refPatterns);
  });

  const fourStroke = sessionOf("水");
  bench("session: draw 水 (4 strokes, typical)", () => {
    for (const prefix of fourStroke) recognize(prefix, refPatterns);
  });

  // Single recognitions at the extremes of the cost curve. These isolate where a change helps:
  // an optimization to the coarse filter should move the 9-stroke case far more than the 1-stroke
  // one, and seeing that asymmetry is how you confirm the change did what you intended.
  const oneStroke = strokesFor("一");
  bench("single: 1 stroke (cheapest)", () => {
    recognize(oneStroke, refPatterns);
  });

  const nineComplete = strokesFor("食");
  bench("single: 9 strokes (peak candidate set)", () => {
    recognize(nineComplete, refPatterns);
  });

  const twentyStroke = strokesFor("議");
  bench("single: 20 strokes (long but narrow candidate set)", () => {
    recognize(twentyStroke, refPatterns);
  });
});
