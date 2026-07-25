import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Dictionary } from "../db";
import { goldCorpus } from "./accuracy/gold";
import { precisionByRegister, scoreCorpus, type Score } from "./accuracy/score";

// Editor-resolution accuracy gate (spec 12 §3). Runs the hand-judged gold corpus through the REAL
// pipeline (tokenizer → resolveByLemma) against the built jisho.db, exactly as a hover would. Two
// guards, per the agreed gate design:
//   1. NAMED regressions hard-fail — the wins already secured (する→為る, 勉強 vs 勉強する, いい→adj)
//      must never break again.
//   2. Per-register precision is reported and floored at a RECORDED baseline, so a broad drop fails
//      the build without a brittle absolute threshold on a small corpus.
//
// Skips when the DB hasn't been built (same policy as db.spec.ts) — an occasional network step.

const DB_PATH = join(process.cwd(), "assets", "jisho.db");
const describeIfDb = existsSync(DB_PATH) ? describe : describe.skip;

// Baselines recorded from the built DB at the time this corpus was authored (measured: every
// register at 1.000 over the decidable words, after the reading-disambiguation fix). Set one word's
// worth below the measured value so a benign upstream dictionary shift doesn't flake the build, but
// a real regression — a second wrong resolution in any register — trips the gate. Raise, never
// lower, as the pipeline and corpus grow.
const PRECISION_FLOOR: Record<
  "overall" | "casual" | "formal" | "literary",
  number
> = {
  overall: 0.95,
  casual: 0.93,
  formal: 0.94,
  literary: 0.88
};

describeIfDb(
  "editor resolution accuracy (hand-judged gold, spec 12 §3)",
  () => {
    let dict: Dictionary;
    let score: Score;
    // Own copy of the DB: db.spec.ts opens the same assets/jisho.db, and Turso takes a file lock
    // that collides when both specs run in parallel on Windows (os error 33). A per-spec copy is the
    // test-isolation fix without touching the shipped read-only open() path.
    const dbCopy = join(tmpdir(), `jisho-accuracy-${process.pid}.db`);

    // Cold-loads the tokenizer WASM/IPADIC (~12MB) and tokenizes the whole corpus once, then scores
    // every case — comfortably past the default 10s hook timeout on a cold cache.
    beforeAll(async () => {
      copyFileSync(DB_PATH, dbCopy);
      dict = await Dictionary.open(dbCopy);
      score = await scoreCorpus(dict, goldCorpus);
    }, 60_000);
    afterAll(async () => {
      await dict?.close();
      rmSync(dbCopy, { force: true });
    });

    test("no named regression resolves incorrectly", () => {
      // WHY: these are the reported failures we already fixed. Each is a hard gate — a fluent reader
      // would never accept して→知る or 勉強する→(nothing), so neither does CI.
      expect(score.regressionFailures).toEqual([]);
    });

    test("every gold word ties to a tokenizer segment", () => {
      // WHY: an unmatched segment means the corpus and tokenizer disagree on where a word is — a
      // corpus bug that would silently inflate precision. Surface it rather than pass it.
      const unmatched = score.outcomes
        .filter((o) => o.status === "unmatched-segment")
        .map((o) => `${o.word.surface} @ ${o.sentence}`);
      expect(unmatched).toEqual([]);
    });

    test("overall precision holds its baseline", () => {
      // Report the misses so a failure names the offending word, not just a number.
      const misses = score.outcomes
        .filter((o) => o.status === "fail")
        .map(
          (o) =>
            `${o.word.surface}→${o.resolved ?? "∅"} (want ${o.word.expect})`
        );
      expect(
        score.precision,
        `precision ${score.precision.toFixed(3)}; misses: ${misses.join(", ") || "none"}`
      ).toBeGreaterThanOrEqual(PRECISION_FLOOR.overall);
    });

    test("per-register precision holds its baseline", () => {
      const byReg = precisionByRegister(score.outcomes);
      for (const register of ["casual", "formal", "literary"] as const) {
        const { passed, decidable } = byReg[register];
        const p = decidable === 0 ? 1 : passed / decidable;
        expect(
          p,
          `${register}: ${passed}/${decidable} = ${p.toFixed(3)}`
        ).toBeGreaterThanOrEqual(PRECISION_FLOOR[register]);
      }
    });
  }
);
