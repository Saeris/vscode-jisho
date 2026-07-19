/**
 * Handwriting recognition benchmark — a simulated drawing SESSION, not a lookup loop.
 *
 * The interaction this models: the UI calls `recognize()` on every stroke end, over all strokes
 * committed so far (see Handwriting.tsx). Drawing a 9-stroke kanji is therefore NINE recognitions
 * of growing prefixes — 1 stroke, then 2, … — and the partial ones are the interesting cases,
 * because a half-drawn character matches nothing well and the fine pass has no early exit.
 *
 * Two properties this gets right that a "recognize a finished character" loop did not:
 *
 *  1. **Prefixes, not just finished characters.** Most recognitions a user triggers are of
 *     incomplete input. Benchmarking only completed characters measures the rarest case.
 *  2. **Stroke count is the cost driver, so it is chosen deliberately.** Cost is NOT flat: it
 *     ranges 1ms (1 stroke) to 17ms (9 strokes) because the coarse filter admits patterns within
 *     ±2 strokes of the input, and the corpus peaks in the middle. Measured over the real corpus,
 *     a 9-stroke input admits 863 of 2,213 patterns — the analytic worst case. The sample set
 *     spans the range and includes it.
 *
 * Point-level jitter was measured and deliberately omitted: perturbing every point by up to 60px
 * changed cost by <1ms (17.1 vs 18.2), because the algorithm walks the same candidates regardless
 * of how well they match. It changes RESULTS, not work — so it belongs in correctness tests, not
 * here. Stroke count is what moves the needle.
 *
 * Run:  vp run bench:build && vp exec node bench/recognize.bench.mjs
 * Then: profile_run { command: ["node", "bench/recognize.bench.mjs"] } → get_findings
 */
import { observed } from "deoptkit/harness";
import { recognize, refPatterns } from "../dist/bench/entry.mjs";

/**
 * Characters spanning the cost curve, including its peak. 食 (9 strokes) is the analytic worst
 * case for the ±2 candidate window; the short ones keep the cheap path represented, since a real
 * session passes through every prefix length on the way up.
 */
const SAMPLE_CHARS = ["一", "人", "口", "水", "字", "食", "問", "識", "議"];

/** A hand never reproduces a stored path exactly; jitter keeps inputs off the canonical values. */
const jitter = (strokes, amount) =>
  strokes.map((stroke) =>
    stroke.map(([x, y]) => [
      x + (Math.random() - 0.5) * amount,
      y + (Math.random() - 0.5) * amount
    ])
  );

/**
 * One drawing session per character: the growing prefixes the UI actually recognizes. Built once
 * so the benchmark measures recognition, not input generation.
 */
const sessions = SAMPLE_CHARS.flatMap((char) => {
  const entry = refPatterns.find((p) => p[0] === char);
  if (!entry) return [];
  const drawn = jitter(entry[2], 8);
  return drawn.map((_, i) => drawn.slice(0, i + 1));
});

if (sessions.length === 0) {
  throw new Error(
    "no reference samples resolved — run `vp run bench:build` first"
  );
}

// Iterations are per-recognition, and a session is many recognitions: this covers ~2,000 stroke
// ends, i.e. roughly 220 complete characters drawn.
observed(
  "recognize",
  (i) => recognize(sessions[i % sessions.length], refPatterns),
  {
    iterations: 2_000
  }
);
