import { existsSync } from "node:fs";
import type {
  Bench,
  BenchRegistration,
  BenchRunOptions,
  ExpectStatic
} from "vite-plus/test";

/**
 * The save-or-compare switch behind `vp run bench:save` and `vp run bench:compare`.
 *
 * Vitest v5 removed `--outputJson` and `--compare`, moving both into the bench itself: a bench
 * writes its own result with `writeResult`, and reads a stored one back with `bench.from()`. The
 * mode is chosen by `VITE_WRITE_BENCH`, which `scripts/bench-baseline.ts` sets.
 *
 * Baselines stay GITIGNORED, unlike the upstream guidance to commit them. They are machine-specific
 * — bench/README.md records deinflect moving 20-40% across machines with no code change, which
 * reads exactly like a regression — so a baseline is only meaningful against itself, on one machine,
 * in one sitting.
 *
 * One file per case rather than the single `bench/baseline.json` v4 wrote, because `writeResult` is
 * a per-bench path. `bench/baselines/` is ignored as a directory.
 */

/**
 * Whether this run is RECORDING a baseline rather than measuring against one.
 *
 * Guarded rather than a bare `process.env`. Vitest v5 gives EVERY project a bench variant, and
 * before those variants were scoped (see `benchmark.include` in vite.config.ts) these files were
 * loaded by the browser project, where `process` does not exist — the import failed outright with
 * "process is not defined", taking eight bench files down with it. Benchmarks are Node-only again,
 * so this is belt and braces: if the projects are ever reshuffled, the baseline silently turns off
 * instead of breaking the run.
 */
export const isWritingBaseline =
  globalThis.process?.env.VITE_WRITE_BENCH === "1";

/** Where a case's recorded result lives. One file per bench — `writeResult` is a per-bench path. */
export const baselinePath = (id: string): string =>
  `./bench/baselines/${id}.json`;

/**
 * The per-bench options that record a baseline, or nothing at all when comparing.
 *
 * Spread into a bench's options: `bench(name, { ...baselineFor("id") }, fn)`. During a comparison
 * run this contributes no options, so the bench simply measures.
 */
export const baselineFor = (
  id: string
): { writeResult: string } | Record<string, never> =>
  isWritingBaseline ? { writeResult: baselinePath(id) } : {};

/**
 * How much slower than its baseline a case may run before the comparison fails.
 *
 * 0.15 (15%) because the measurement floor is genuinely noisy, and the README says so from
 * experience: two runs of IDENTICAL code on the recognizer differed by up to ~9%, and `[0.91x] ⇓`
 * was observed with no code change at all. A tighter bound would fail on a quiet machine having a
 * bad minute, and a guard that cries wolf gets switched off.
 *
 * This bounds a REGRESSION only. A case getting faster is never a failure.
 */
export const REGRESSION_DELTA = 0.15;

/**
 * Run a bench, and when a baseline exists, FAIL if it regressed beyond `REGRESSION_DELTA`.
 *
 * This is what makes `vp run bench:compare` a guard rather than a second opinion. Vitest v5 removed
 * `--compare`, which used to annotate each case `[1.34x] ⇑` / `[0.87x] ⇓` in the reporter; the
 * replacement is an assertion inside the bench, so a regression is a RED TEST rather than a number
 * a reader has to notice.
 *
 * Two runs skip the comparison and simply measure:
 *   - RECORDING (`vp run bench:save`), where there is nothing to compare against yet.
 *   - No baseline file, which is a fresh checkout. `vp run bench` must stay useful as a plain
 *     "what are the numbers" command, so a missing baseline is not a failure.
 *
 * Throughput means are compared by hand rather than with `toBeSlowerThan`. That matcher's `delta`
 * is a MINIMUM REQUIRED DIFFERENCE, not a tolerance: `toBeSlowerThan(x, { delta: 0.15 })` asserts
 * the other side is slower by at least 15%, so using it here demanded a 15% speedup on every run
 * and failed with "Expected to be slower by at least 15%, but was only 2.79% slower". The question
 * this needs to ask — "is the current run no more than 15% WORSE" — has no matcher.
 */
export const against = async (
  bench: Bench,
  expect: ExpectStatic,
  id: string,
  current: BenchRegistration<string>,
  /**
   * Run options, e.g. `{ iterations: 5 }` for the whole-document cases that take ~4s each. Passed
   * to BOTH paths, so a recording run and a comparison run sample the workload the same number of
   * times — comparing 5 iterations against 500 would measure the sampling, not the code.
   */
  options?: BenchRunOptions
): Promise<void> => {
  if (isWritingBaseline || !existsSync(baselinePath(id))) {
    // `.run()`, not `compare()`: comparing one benchmark against nothing is a SyntaxError —
    // "requires at least 2 benchmarks, received 1".
    await current.run(options);
    return;
  }
  const baseline = bench.from("baseline", baselinePath(id));
  const result = await (options === undefined
    ? bench.compare(current, baseline)
    : bench.compare(current, baseline, options));
  const now = result.get(current.name).throughput.mean;
  const before = result.get("baseline").throughput.mean;
  // Throughput, so HIGHER is faster: the floor is the baseline minus the tolerance. A case that
  // got faster sails past it, which is the intent — this bounds regressions only.
  expect(
    now,
    `${id}: ${now.toFixed(0)} ops/sec against a baseline of ${before.toFixed(0)} ` +
      `(${(((now - before) / before) * 100).toFixed(1)}%, tolerance ${REGRESSION_DELTA * 100}%)`
  ).toBeGreaterThan(before * (1 - REGRESSION_DELTA));
};
