/**
 * Handwriting-recognition benchmark for deoptkit.
 *
 * Why this workload first: `recognize()` is the heaviest pure-JavaScript path we own — moment
 * normalization, feature extraction, then coarse and fine classification across ~1,200 reference
 * patterns — and it runs on user input while someone is drawing, where a stall is felt directly.
 * The database and the tokenizer are heavier overall, but they are native/WASM: V8 sees an opaque
 * call, so deoptkit has nothing to say about them (see docs/specs/07-performance.md).
 *
 * Inputs are deliberately VARIED — different characters, stroke counts, and point densities. A loop
 * over one character would warm a single hidden class and hide exactly the polymorphism this tool
 * exists to find.
 *
 * Run:  vp exec node bench/recognize.bench.mjs
 * Then: profile_run { command: ["node", "bench/recognize.bench.mjs"] } → get_findings
 */
import { observed } from "deoptkit/harness";
import { recognize, refPatterns } from "../dist/bench/entry.mjs";

// A spread of stroke counts (1 → 20+) so the coarse filter's ±2 stroke window admits different
// candidate-set sizes per iteration, exercising both the early-out and the full fine pass.
const SAMPLE_CHARS = [
  "一", // 1 stroke — trivial case, huge candidate set
  "人", // 2
  "口", // 3
  "水", // 4
  "字", // 6
  "học", // absent → exercises the no-match path
  "食", // 9
  "問", // 11
  "識", // 19
  "議" // 20
];

const samples = SAMPLE_CHARS.map((char) => {
  const entry = refPatterns.find((p) => p[0] === char);
  // Missing characters are intentional (see 学 above): they exercise the path where nothing
  // matches, which real users hit constantly while a character is half-drawn.
  return entry ? entry[2] : [];
}).filter((strokes) => strokes.length > 0);

if (samples.length === 0) {
  throw new Error("no reference samples resolved — is dist/bench built?");
}

observed(
  "recognize",
  (i) => recognize(samples[i % samples.length], refPatterns),
  {
    iterations: 2_000
  }
);
