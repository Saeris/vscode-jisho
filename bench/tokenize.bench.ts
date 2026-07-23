/**
 * Throughput benchmark for tokenization and the highlighting walk over a real document — the
 * "did my change help?" measurement for heavy-document load, which the recognizer bench doesn't
 * cover.
 *
 *   this file → ops/sec + margin of error → WHETHER a tokenizer/detection change made it faster.
 *
 * Note (see docs/specs/07): the tokenizer is a WASM module, opaque to deoptkit, so there is no
 * companion `.mjs` deopt profile — this measures throughput, not WHY.
 *
 * The corpus is a whole NOVEL — 吾輩は猫である (Sōseki), ~2,255 lines / ~320K chars — deliberately,
 * because that is where performance work pays off: sustained load exposes per-call overhead and
 * allocation churn that a short excerpt hides. The smaller 羅生門 fixture is used for the correctness
 * tests, where fast stable runs matter more than weight.
 *
 * Run:      vp run bench
 * Baseline: vp run bench:save
 * Compare:  vp run bench:compare
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bench, describe } from "vitest";
import { segment } from "../src/host/tokenizer";
import { japaneseRuns, stripRuby } from "../src/host/hover";

const HAS_KANJI = /[㐀-鿿豈-﫿]/;

const corpus = readFileSync(
  fileURLToPath(new URL("./fixtures/wagahai-neko.txt", import.meta.url)),
  "utf8"
)
  .split("\n")
  .filter((l) => l.trim() !== "" && !l.startsWith("#"));

/** Warm the WASM tokenizer once before any measured run, so the ~200ms build isn't in the numbers. */
const warm = segment("日本語");

describe("tokenize", () => {
  // The whole-document cases (~4s each) are the heavy load a perf change targets: opening a long
  // file with the hover or highlighting active does this much work. A handful of iterations gives a
  // stable mean without making `vp run bench` take minutes — the point is a before/after delta on
  // heavy load, not a tight ops/sec; a few samples of a 4s workload resolve a real change well past
  // noise.
  const heavy = {
    warmupIterations: 1,
    iterations: 5,
    setup: async () => void (await warm)
  };

  // Whole document, tokenized line by line.
  bench(
    "tokenize 吾輩は猫である (~2,255 lines, line by line)",
    async () => {
      for (const line of corpus) await segment(line);
    },
    heavy
  );

  // The full highlighting walk: what provideSemanticTokens does per line — strip ruby/markdown, find
  // Japanese runs, tokenize each. Measures the detection overhead ON TOP of tokenization.
  bench(
    "highlight walk 吾輩は猫である (strip + runs + tokenize)",
    async () => {
      for (const line of corpus) {
        const stripped = stripRuby(line);
        for (const run of japaneseRuns(stripped.text)) {
          if (HAS_KANJI.test(run.text)) await segment(run.text);
        }
      }
    },
    heavy
  );

  // A single representative sentence, to isolate per-call cost from whole-document iteration.
  const sentence = "吾輩は猫である。名前はまだ無い。";
  bench(
    "tokenize one sentence",
    async () => {
      await segment(sentence);
    },
    { setup: async () => void (await warm) }
  );
});
