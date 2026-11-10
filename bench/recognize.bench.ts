/**
 * Throughput benchmarks for the handwriting recognizer — the "did my change help?" measurement.
 *
 * The same cases answer two questions, in two modes:
 *   - `vp run bench`         → ops/sec + margin of error → WHETHER a change made it faster
 *   - `vp run bench:profile` → deoptkit → WHY a path is slow (inline caches, deopts, where ticks go)
 * Only the first can gate a regression on speed; the second gates structural findings in CI.
 *
 * Run:      vp run bench
 * Baseline: vp run bench:save     (writes bench/baselines/recognize-*.json)
 * Compare:  vp run bench:compare  (fails any case >15% slower than its baseline)
 *
 * NEEDS NODE 25+. `patterns.ts` decodes with `Uint8Array.fromBase64`, which is a browser API that
 * only reached Node in 25 — the spec version of this code is routed to the browser project for the
 * same reason (see `BROWSER_ONLY` in vite.config.ts). That is why CI's deopt job, which profiles
 * this file, runs on Node 26 rather than the extension host's 24.22. It is recorded because the
 * failure ("Uint8Array.fromBase64 is not a function") names the API and not the reason.
 *
 * Methodology — and why the inputs look like this — is in bench/README.md. The short version: cost
 * is driven by STROKE COUNT (17× across the range, non-monotonic, peaking at 9 strokes where the
 * ±2 candidate window admits 863 of 2,213 patterns), not by how wobbly the strokes are.
 */
import { benchObserved } from "deoptkit/bench";
import { it, describe } from "vite-plus/test";
import { against, baselineFor } from "./baseline";
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
  return jitter(entry[2], 8);
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
  it("session: draw 食 (9 strokes, worst-case candidate set)", async ({
    bench
  }) => {
    await against(
      bench,
      expect,
      "recognize-session-draw-9-strokes-worst-case-candidate-set",
      benchObserved(
        bench,
        "session: draw 食 (9 strokes, worst-case candidate set)",
        () => {
          for (const prefix of nineStroke) recognize(prefix, refPatterns);
        },
        baselineFor("recognize-session-draw-9-strokes-worst-case-candidate-set")
      )
    );
  });

  const fourStroke = sessionOf("水");
  it("session: draw 水 (4 strokes, typical)", async ({ bench, expect }) => {
    await against(
      bench,
      expect,
      "recognize-session-draw-4-strokes-typical",
      benchObserved(
        bench,
        "session: draw 水 (4 strokes, typical)",
        () => {
          for (const prefix of fourStroke) recognize(prefix, refPatterns);
        },
        baselineFor("recognize-session-draw-4-strokes-typical")
      )
    );
  });

  // Single recognitions at the extremes of the cost curve. These isolate where a change helps:
  // an optimization to the coarse filter should move the 9-stroke case far more than the 1-stroke
  // one, and seeing that asymmetry is how you confirm the change did what you intended.
  const oneStroke = strokesFor("一");
  it("single: 1 stroke (cheapest)", async ({ bench, expect }) => {
    await against(
      bench,
      expect,
      "recognize-single-1-stroke-cheapest",
      benchObserved(
        bench,
        "single: 1 stroke (cheapest)",
        () => {
          recognize(oneStroke, refPatterns);
        },
        baselineFor("recognize-single-1-stroke-cheapest")
      )
    );
  });

  const nineComplete = strokesFor("食");
  it("single: 9 strokes (peak candidate set)", async ({ bench, expect }) => {
    await against(
      bench,
      expect,
      "recognize-single-9-strokes-peak-candidate-set",
      benchObserved(
        bench,
        "single: 9 strokes (peak candidate set)",
        () => {
          recognize(nineComplete, refPatterns);
        },
        baselineFor("recognize-single-9-strokes-peak-candidate-set")
      )
    );
  });

  const twentyStroke = strokesFor("議");
  it("single: 20 strokes (long but narrow candidate set)", async ({
    bench
  }) => {
    await against(
      bench,
      expect,
      "recognize-single-20-strokes-long-but-narrow-candidate-set",
      benchObserved(
        bench,
        "single: 20 strokes (long but narrow candidate set)",
        () => {
          recognize(twentyStroke, refPatterns);
        },
        baselineFor("recognize-single-20-strokes-long-but-narrow-candidate-set")
      )
    );
  });
});
