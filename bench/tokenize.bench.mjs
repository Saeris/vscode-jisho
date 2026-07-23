/**
 * Tokenization / highlight-walk deopt profile — the "WHY is this slow?" companion to
 * tokenize.bench.ts's "did it get faster?".
 *
 * IMPORTANT CAVEAT (spec 07): the tokenizer itself is a 12MB WASM module (Lindera/IPADIC). From
 * V8's view a `segment()` call is largely an opaque descent into WASM, so most wall-clock time will
 * NOT appear as attributable JS ticks. What deoptkit CAN see, and what this profile is actually
 * for, is the JavaScript AROUND the WASM call:
 *   - `segment`'s own folding loop (auxiliary/suffix coalescing, the DetailedSegment construction)
 *   - the highlight walk's `stripRuby` (index-map building) and `japaneseRuns` (regex + map)
 * Those run per line over a whole novel, so if there is JS-side churn (megamorphic ICs, deopts,
 * per-line allocation) it will show here.
 *
 * Run:  vp run bench:build && vp exec node bench/tokenize.bench.mjs
 * Then: profile_run { command: ["node", "bench/tokenize.bench.mjs"] }
 *       get_findings { sessionId, fromMark: "tokenize_start", toMark: "tokenize_end" }
 *       list_functions { sessionId }
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mark } from "deoptkit/harness";
import { segment, stripRuby, japaneseRuns } from "../dist/bench/entry.mjs";

const HAS_KANJI = /[㐀-鿿豈-﫿]/;

const corpus = readFileSync(
  fileURLToPath(new URL("./fixtures/wagahai-neko.txt", import.meta.url)),
  "utf8"
)
  .split("\n")
  .filter((l) => l.trim() !== "" && !l.startsWith("#"));

// Warm the WASM once so its init isn't profiled as tokenization.
await segment("日本語");

// A sink so dead-code elimination can't delete the work whose result we ignore.
let sink = 0;

// The awaits are SEQUENTIAL on purpose — this profiles per-call boundary cost the way the real
// extension calls the tokenizer (one line at a time). Promise.all would fire every tokenization
// concurrently, which measures the wrong thing and would hold the whole novel's results in memory
// at once. So the no-await-in-loop rule is a false positive here.
/* eslint-disable no-await-in-loop */
const tokenizePass = async () => {
  for (const line of corpus) {
    const segs = await segment(line);
    sink += segs.length;
  }
};

const highlightPass = async () => {
  for (const line of corpus) {
    const stripped = stripRuby(line);
    for (const run of japaneseRuns(stripped.text)) {
      if (HAS_KANJI.test(run.text)) {
        const segs = await segment(run.text);
        sink += segs.length;
      }
    }
  }
};
/* eslint-enable no-await-in-loop */

// `observed`'s iteration loop is synchronous; `segment` is async, so we bracket manual async loops
// with `mark()` instead — same in-band V8-log markers, usable as fromMark/toMark windows. Several
// passes so V8 warms and hot JS reaches the optimized state a real long-file session would.
const PASSES = 3;

// One un-profiled pass first so the WASM dictionary caches and JS tiers begin warming before the
// window opens — otherwise the first-pass cold costs dominate the window.
await tokenizePass();
await highlightPass();

// Sequential passes, deliberately — each must finish before the next so the profile window sees
// warmed, steady-state work rather than overlapping cold passes.
/* eslint-disable no-await-in-loop */
mark("tokenize_start");
for (let i = 0; i < PASSES; i++) await tokenizePass();
mark("tokenize_end");

mark("highlight_start");
for (let i = 0; i < PASSES; i++) await highlightPass();
mark("highlight_end");
/* eslint-enable no-await-in-loop */

console.log(`sink=${sink}`);
