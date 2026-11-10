/**
 * Run the benchmarks in one of their two non-default modes.
 *
 *   vp run bench:save                         record bench/baselines/* for bench:compare
 *   vp run bench:profile                      record V8 logs + .deopt/findings.json via deoptkit
 *   vp run bench:profile -- bench/x.bench.ts  either mode, narrowed to some files
 *
 * Both are environment switches that `vite.config.ts` and `bench/baseline.ts` read, and they are
 * separate modes on purpose: V8 logging slows every case, so a baseline recorded under the profiler
 * would make every later comparison look like a regression.
 *
 * A script rather than `VITE_WRITE_BENCH=1 …` inline in package.json, because that syntax is
 * POSIX-only and this repo is developed on Windows.
 */
import { spawnSync } from "node:child_process";

const MODES = {
  save: { VITE_WRITE_BENCH: "1" },
  profile: { DEOPTKIT: "1" }
} as const;

const isMode = (value: string): value is keyof typeof MODES =>
  Object.hasOwn(MODES, value);

const [mode = "", ...rest] = process.argv.slice(2);
// `vp run bench:profile -- <files>` forwards the `--` as well, and Vitest ignores every argument
// after one, so the files never narrowed the run until it was dropped here.
const files = rest[0] === "--" ? rest.slice(1) : rest;
if (!isMode(mode)) {
  console.error(`usage: bench.ts <${Object.keys(MODES).join("|")}> [files…]`);
  process.exit(2);
}
const env = MODES[mode];

const result = spawnSync("vp", ["test", "bench", "--run", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...env }
});

process.exit(result.status ?? 1);
