/**
 * Throughput benchmark for tokenization and the highlighting walk over a real document — the
 * "did my change help?" measurement for heavy-document load, which the recognizer bench doesn't
 * cover.
 *
 *   this file → ops/sec + margin of error → WHETHER a tokenizer/detection change made it faster.
 *
 * Note (see docs/specs/07): the tokenizer is a WASM module, opaque to deoptkit, so there is no
 * companion `.mjs` deopt profile — this measures throughput, not WHY. The corpus is the vendored
 * 羅生門 (Akutagawa), ~5,700 chars of literary prose, the same fixture the corpus correctness tests
 * use.
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
  fileURLToPath(new URL("./fixtures/rashomon.txt", import.meta.url)),
  "utf8"
)
  .split("\n")
  .filter((l) => l.trim() !== "" && !l.startsWith("#"));

/** Warm the WASM tokenizer once before any measured run, so the ~200ms build isn't in the numbers. */
const warm = segment("日本語");

describe("tokenize", () => {
  // The whole document tokenized line by line — the heavy case: opening a long file with the hover
  // (or highlighting) active means this much work.
  bench(
    "tokenize 羅生門 (~5,700 chars, line by line)",
    async () => {
      for (const line of corpus) await segment(line);
    },
    { setup: async () => void (await warm) }
  );

  // The full highlighting walk: what provideSemanticTokens does per line — strip ruby/markdown, find
  // Japanese runs, tokenize each. Measures the detection overhead ON TOP of tokenization.
  bench(
    "highlight walk 羅生門 (strip + runs + tokenize)",
    async () => {
      for (const line of corpus) {
        const stripped = stripRuby(line);
        for (const run of japaneseRuns(stripped.text)) {
          if (HAS_KANJI.test(run.text)) await segment(run.text);
        }
      }
    },
    { setup: async () => void (await warm) }
  );

  // A single representative sentence, to isolate per-call cost from whole-document iteration.
  const sentence = "一人の下人が、羅生門の下で雨やみを待っていた。";
  bench(
    "tokenize one sentence",
    async () => {
      await segment(sentence);
    },
    { setup: async () => void (await warm) }
  );
});
