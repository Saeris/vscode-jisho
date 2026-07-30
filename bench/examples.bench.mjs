/**
 * Example-markup deopt profile — the "WHY is this slow / is it well-shaped?" companion to
 * examples.bench.ts's "did it get faster?".
 *
 * Pure JS, so deoptkit sees all of it and a finding here is actionable. What the first pass found,
 * and what it settled (2026-07-30):
 *
 *  * The LINK regex is the cost, at 104 of ~180 JS ticks. Nothing else is close, and it is the actual
 *    parsing work rather than overhead around it — so `parseExampleMarkup` is left alone.
 *  * The one standing finding is a megamorphic KeyedLoadIC in `parseExampleMarkup` on `CODE_POS[code]`
 *    — a string-keyed table lookup, which deoptkit itself calls "often inherent to generic dispatch".
 *    NOT fixed on purpose: the whole function is 29 ticks against the regex's 104, so converting the
 *    table to a `Map` would be optimizing a site the profile says is not where the time goes. This is
 *    the README's "trust the ticks" rule in practice — findings say what is shaped badly, ticks say
 *    what costs.
 *  * The union pushed into `parts` (`{kind:"link",markup,pos,id}` vs `{kind:"text",markup}`) looked
 *    like a textbook polymorphic-IC setup. V8 does not care: no finding names it.
 *  * `stripRubyText`'s per-match unescape DID matter — 1.2% of ticks for a case occurring in 0 of
 *    133,570 corpus sentences. Guarded, and it is now absent from the profile entirely.
 *
 * Run:  vp run bench:build && vp exec node bench/examples.bench.mjs
 * Then: profile_run { command: ["node", "bench/examples.bench.mjs"] }
 *       get_findings { sessionId, fromMark: "hover_start", toMark: "hover_end" }
 *       list_functions { sessionId }
 * Or headless (no MCP): vp exec deoptkit ci bench/examples.bench.mjs
 */
import { readFileSync } from "node:fs";
import { observed } from "deoptkit/harness";
import {
  exampleText,
  parseExampleMarkup,
  stripRubyText,
  wordHoverMarkdown
} from "../dist/bench/entry.mjs";

// The same distribution-faithful sample the throughput bench uses, cycled so V8 sees varied inputs
// rather than one repeated string (bench/README.md rule 3).
const { mix } = JSON.parse(
  readFileSync(
    new URL("fixtures/examples-markup.json", import.meta.url),
    "utf8"
  )
);

let sink = 0;

const hoverFor = (jaFurigana, en) => ({
  headword: "注意",
  reading: "ちゅうい",
  breakdown: null,
  senses: [
    {
      partOfSpeech: [{ code: "n", description: "noun" }],
      glosses: ["attention", "notice", "heed"],
      sentences: [{ jaFurigana, en }]
    }
  ]
});

// Each window is marked separately so findings can be attributed to one layer instead of to the
// whole path — the strip and the link parse have different suspected problems.
const ITERATIONS = 200_000;

observed(
  "parse",
  (i) => {
    sink += parseExampleMarkup(mix[i % mix.length].jaFurigana).length;
  },
  { iterations: ITERATIONS }
);

observed(
  "strip",
  (i) => {
    sink += stripRubyText(mix[i % mix.length].jaFurigana).length;
  },
  { iterations: ITERATIONS }
);

observed(
  "exampleText",
  (i) => {
    sink += exampleText(mix[i % mix.length].jaFurigana).length;
  },
  { iterations: ITERATIONS }
);

// The hover is the path with a real interaction budget: it renders on cursor rest.
observed(
  "hover",
  (i) => {
    const { jaFurigana, en } = mix[i % mix.length];
    sink += wordHoverMarkdown(hoverFor(jaFurigana, en)).length;
  },
  { iterations: ITERATIONS }
);

console.log(`sink=${sink}`);
