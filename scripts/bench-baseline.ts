/**
 * Refresh the benchmark baseline that `vp run bench:compare` measures against.
 *
 * Vitest v5 removed `--outputJson`/`--compare`: a bench now writes its own result via the
 * `writeResult` option and reads the stored one back with `bench.from()`. Both live in the bench
 * FILE, so the only thing left for a script to decide is which of the two modes runs — which the
 * bench files read from `VITE_WRITE_BENCH`.
 *
 * This exists rather than an inline `VITE_WRITE_BENCH=1 …` in package.json because that syntax is
 * POSIX-only and this repo is developed on Windows. A `cross-env` dependency would also do it; a
 * four-line script that spawns the same command is less to install and easier to read than either.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("vp", ["test", "bench", "--run"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_WRITE_BENCH: "1" }
});

process.exit(result.status ?? 1);
