/**
 * Handwriting recognition benchmark — a simulated drawing SESSION, not a lookup loop.
 *
 * Methodology and the reasoning behind every choice here: bench/README.md.
 *
 * The interaction: the UI calls `recognize()` on every stroke end, over all strokes committed so
 * far (Handwriting.tsx). Drawing a 9-stroke kanji is therefore NINE recognitions of growing
 * prefixes — and the partial ones matter most, because a half-drawn character matches nothing well
 * and the fine pass gets no early exit.
 *
 * Input design, measured rather than assumed:
 *  - **Stroke count is the cost driver** (1 → 17 ms, a 17× spread); point jitter is noise (<1 ms
 *    across a 0–60 px sweep). So the sample spans the stroke-count curve, and jitter exists only to
 *    keep inputs off the canonical values.
 *  - The curve is **non-monotonic**: 食 (9 strokes) costs more than 議 (20), because the coarse
 *    filter admits patterns within ±2 strokes and the corpus peaks in the middle. Computed over the
 *    real corpus, a 9-stroke input admits 863 of 2,213 patterns — the analytic worst case, included
 *    deliberately.
 *  - Repeating one input inflates results by only ~3.4% here (V8 confirms every input shares one
 *    hidden class), so the JIT is not the thing to defend against — the input DISTRIBUTION is,
 *    which moved results ~2×.
 *
 * Run:  vp run bench:build && vp exec node bench/recognize.bench.mjs
 * Then: profile_run { command: ["node", "bench/recognize.bench.mjs"] } → get_findings
 */
import { observed } from "deoptkit/harness";
import { recognize, refPatterns } from "../dist/bench/entry.mjs";

/** Characters spanning the cost curve, including its 9-stroke peak. */
const SAMPLE_CHARS = ["一", "人", "口", "水", "字", "食", "問", "識", "議"];

/** A hand never reproduces a stored path exactly; keeps inputs off the canonical values. */
const jitter = (strokes, amount) =>
  strokes.map((stroke) =>
    stroke.map(([x, y]) => [
      x + (Math.random() - 0.5) * amount,
      y + (Math.random() - 0.5) * amount
    ])
  );

/**
 * One drawing session per character: the growing prefixes the UI actually recognizes. Built once,
 * so the benchmark measures recognition rather than input generation.
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

// Dead-code elimination will delete work whose result is never used; accumulating the output keeps
// the call observable.
let sink = 0;

// ~2,000 stroke ends ≈ 220 complete characters drawn.
observed(
  "recognize",
  (i) => {
    sink += recognize(sessions[i % sessions.length], refPatterns).length;
  },
  { iterations: 2_000 }
);

// A distribution, not a mean: the average is unremarkable while p95 is the moment a user finishes
// a complex character — the only latency they actually notice.
const timings = sessions
  .map((strokes) => {
    const started = performance.now();
    sink += recognize(strokes, refPatterns).length;
    return performance.now() - started;
  })
  .sort((a, b) => a - b);

const at = (q) =>
  timings[Math.min(timings.length - 1, Math.floor(timings.length * q))];
console.log(
  `recognitions=${timings.length} ` +
    `p50=${at(0.5).toFixed(1)}ms p95=${at(0.95).toFixed(1)}ms max=${at(1).toFixed(1)}ms`
);
if (sink === 0) {
  throw new Error("recognizer produced nothing — inputs are wrong");
}
