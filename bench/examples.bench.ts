/**
 * Throughput benchmark for the example-sentence markup path — the "did my change make it faster?"
 * measure for `parseExampleMarkup` / `exampleText`.
 *
 * Why this exists: as of 2026-07-30 the stored markup is parsed on EVERY surface that shows an
 * example, which was not true before. The word page used to render a pre-stripped plain string; it
 * now renders `ExampleSentence`, and the editor hover derives plain text through `exampleText`. Both
 * are user-facing paths that previously did no parsing at all, so this exists to CATCH A REGRESSION
 * on them — not because parsing is slow today (it is single-digit microseconds).
 *
 * The hover is the one to watch. It renders on cursor rest, so its cost lands in the editor's
 * interaction budget rather than in a page transition the user already expects to take a moment.
 *
 * Input design, measured against the real corpus before writing (bench/README.md rule 2 — find the
 * driver, vary that): cost tracks the NUMBER OF LINKS, since each match walks the regex and appends
 * two parts. Sentence length matters only as far as it carries links. Corpus-wide, per sentence:
 *
 *   links   p50 5    p95 10   max 20-22
 *   chars   p50 96   p95 203  max 425
 *
 * `fixtures/examples-markup.json` therefore ships two sets: `mix`, sampled every 337th row so it
 * inherits the corpus's own distribution (rule 3 — a hand-picked spread skewed p50 from 5 links to
 * 10, which would have overstated the typical case ~2x), and `worst`, the top of the link range.
 *
 * Cases are INTERACTION TOTALS, not per-call figures (rule 1). What the UI does per surface:
 *
 *   hover              1 sentence   — one example, through the whole markdown body
 *   word page          6 sentences  — EXAMPLE_PREVIEW (2) per sense, ~3 senses (corpus avg 1.6)
 *   more-examples page 20 sentences — the pooled page
 *
 * Run:      vp run bench
 * Baseline: vp run bench:save
 * Compare:  vp run bench:compare
 */
import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import { exampleText, parseExampleMarkup } from "../src/shared/exampleLinks";
import { wordHoverMarkdown, type WordHover } from "../src/shared/hoverHtml";

interface Fixture {
  mix: { jaFurigana: string; en: string }[];
  worst: { jaFurigana: string; en: string }[];
}

const { mix, worst }: Fixture = JSON.parse(
  readFileSync(
    new URL("fixtures/examples-markup.json", import.meta.url),
    "utf8"
  )
);

let sink = 0;

/** Walk the fixture rather than repeating one sentence, so V8 sees varied inputs (rule 3). */
const cursor = (from: readonly { jaFurigana: string }[]): (() => string) => {
  let i = 0;
  return () => from[i++ % from.length].jaFurigana;
};

const hoverFor = (jaFurigana: string, en: string): WordHover => ({
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

describe("example markup", () => {
  // The headline numbers: what one user interaction costs, on a distribution-faithful sample.
  const hoverNext = cursor(mix);
  bench("hover: 1 sentence through the whole markdown body", () => {
    const jaFurigana = hoverNext();
    sink += wordHoverMarkdown(
      hoverFor(jaFurigana, "Please be careful.")
    ).length;
  });

  const pageNext = cursor(mix);
  bench("word page: 6 inline examples parsed for render", () => {
    for (let i = 0; i < 6; i++) sink += parseExampleMarkup(pageNext()).length;
  });

  const poolNext = cursor(mix);
  bench("more-examples page: 20 pooled examples parsed", () => {
    for (let i = 0; i < 20; i++) sink += parseExampleMarkup(poolNext()).length;
  });

  // The two layers isolated, so a change can be attributed. `exampleText` is `parseExampleMarkup`
  // plus a ruby strip, so the gap between these two IS the strip's cost.
  const parseNext = cursor(mix);
  bench("parse only: 1 sentence (link layer)", () => {
    sink += parseExampleMarkup(parseNext()).length;
  });

  const textNext = cursor(mix);
  bench("exampleText: 1 sentence (both layers stripped)", () => {
    sink += exampleText(textNext()).length;
  });

  // The tail: ~22 links in one sentence. Guards against a change that is fine at the median and
  // quadratic at the top of the range.
  const worstNext = cursor(worst);
  bench("worst: 1 sentence at the top of the link range", () => {
    sink += parseExampleMarkup(worstNext()).length;
  });
});

// Keep `sink` observable so the compiler can't delete the calls (bench/README.md rule 5).
if (sink === -1) throw new Error(String(sink));
