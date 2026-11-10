# Benchmarks

One file per subject (`*.bench.ts`), run in two modes that answer two different questions. Both matter; neither replaces the other.

|           | `vp run bench` (throughput)            | `vp run bench:profile` (deoptkit)           |
| --------- | -------------------------------------- | ------------------------------------------- |
| Question  | **Did my change make it faster?**      | **Why is this slow?**                       |
| Output    | ops/sec, percentiles, margin of error  | inline-cache states, deopts, where ticks go |
| Use it to | gate regressions, compare before/after | decide what to optimize; gate structure     |

## Throughput — "did my change help?"

```
vp run bench           # run, print ops/sec + p75/p99 + margin of error
vp run bench:save      # record the current numbers as bench/baselines/*.json
# …make a change…
vp run bench:compare   # re-run and FAIL any case more than 15% slower than its baseline
```

Baselines are **gitignored on purpose**: they are machine-specific, so comparing your numbers to CI's or a teammate's measures the hardware, not the change. Save a baseline, change code, compare on the same machine in the same session.

`bench:compare` **fails the run** on a regression rather than annotating one. Vitest v5 removed the `--compare` flag that used to print `[1.34x] ⇑` / `[0.87x] ⇓` beside each case; the replacement is an assertion inside the bench (`against()` in `baseline.ts`), so a regression is a red test instead of a number you have to notice. The tolerance is **15%**, chosen against the noise floor documented below — a case that gets FASTER never fails.

With no baseline on disk, `bench:compare` just measures. A fresh checkout has nothing to compare against, and the command stays useful as "what are the numbers".

**Absolute microsecond figures in the `*.bench.ts` headers are indicative, not baselines.** They were measured on whichever machine wrote them, so treat the SPREAD between cases as the portable claim and the absolutes as a rough scale. Re-measuring deinflect on a different machine moved every case 20-40% with no code change, which reads exactly like a regression if you compare across machines.

**Read the margin of error before believing a delta.** Two runs of _identical_ code on this project's recognizer differ by up to ~9% (`[0.91x] ⇓` was observed with no code change at all), and `rme` is typically ±1–4%. A change under ~10% is noise unless it reproduces across several runs. Close other applications for anything you intend to act on.

## Profiling — "why is it slow?"

```
vp run bench:profile                                                  # every bench, V8-logged
vp run bench:profile -- bench/dictionary.bench.ts -t "refineCounts"   # narrowed
```

This runs the same cases under deoptkit's Vitest preset (deoptkit 0.3+, Vitest 5): one V8 log per worker in `.deopt/`, a `manifest.json` for the MCP server's `load_manifest`, and a `findings.json` that `deoptkit lsp` shows as editor diagnostics. Every case is wrapped in `benchObserved`, so each has `<name>_start`/`<name>_end` window markers. It is a separate mode from `bench:compare` on purpose: logging slows every case, so a baseline recorded under it would make every later comparison read as a regression, and `against()` does not compare while profiling.

**Each case runs a fixed number of times.** Vitest normally runs a case for a time budget, so under logging a fast case ran hundreds of thousands of times: with every category on, the JS benches passed 6 GB, and `refineCounts` alone wrote 8.4 GB before it was stopped. A profile run instead calls each case `PROFILE_ITERATIONS` times (1,000, in `vite.config.ts`), through deoptkit's benchmark provider, with no time budget and no warm-up. A case whose every call logs a lot asks for fewer with `profileRuns(n)` (in `baseline.ts`), which a throughput run ignores: the dictionary cases run 30 times, because each query logs an inline-cache event per row it walks. Measured with every category on: 27–32 MiB per JS subject, 81 MiB for the dictionary (657 MiB at 1,000 calls). About 27 MiB of every log is written before the first case runs.

**For ticks alone, narrow the categories.** `deopts,profile,sources` keeps the ticks, which answer "where does the time go", and drops the inline-cache and map events:

```
DEOPTKIT_CATEGORIES=deopts,profile,sources vp run bench:profile -- bench/dictionary.bench.ts
vp exec node --prof-process .deopt/v8-<pid>.log      # the worker whose log holds your window
```

The worker that ran a case is the log containing its marker: `grep -l "__DEOPT_MARK__refineCounts_noun" .deopt/*.log`.

With the deopt MCP server connected (deoptkit's plugin), `profile_run` / `get_findings` / `list_functions` answer the same questions interactively; `load_manifest` loads a `bench:profile` run.

### The structural gate

`deoptkit ci` **is a CI gate** (the `deopt` job in `ci.yml`). It profiles the four plain-JS subjects (deinflect, recognize, editorCommands, examples) and compares the run's findings with the committed baseline; a new finding fails the build. The fixed count is what makes this work: the same run gives the same findings, here and on the CI runner.

```
vp run bench:profile -- bench/deinflect.bench.ts bench/recognize.bench.ts bench/editorCommands.bench.ts bench/examples.bench.ts
vp exec deoptkit ci --out-dir .deopt --manifest .deopt/manifest.json            # compare
vp exec deoptkit ci --update --out-dir .deopt --manifest .deopt/manifest.json   # accept the current findings
```

`.deopt/baselines/` **is committed**, unlike `bench/baselines/`, and the difference is the point: throughput is a property of the machine, while a megamorphic IC or a deopt loop is a property of the code. So findings port across machines and can gate; ops/sec cannot. The baseline (`.deopt__manifest.json.json`, named after the manifest's path) was built with `--accumulate` over three runs and matched a fourth. Run the same four files when you update it: a run over fewer reports the rest as findings that no longer occur.

The gate runs on **Node 26**, not the extension host's 24.22, because the recognizer bench cannot run on Node 24 at all: its patterns decode with `Uint8Array.fromBase64` (Chromium 148 and Node 25+ only). When a finding is expected (a refactor can move one: wrapping the tokenizer build in `lazy()` changed the map-churn finding's function name from empty to `buildTokenizer`), accept it with `--update` and commit the baseline in the same change.

These benches run `src/` through Vite's module runner, not the built bundle that the old `*.bench.mjs` workloads loaded (they were folded in on 2026-11-09, HARDENING-PLAN D-6). V8 inlines differently across the two, so a finding can report in a different function: the `alignReading` deopt loop now reports in its caller, `addFuriganaToLine`.

**Ticks and findings often disagree — trust the ticks.** On the recognizer, the flagged inline-cache sites hold ~1.5% of CPU while the two functions holding 67% produce no findings at all. On the dictionary it is starker: `refineCounts` spends **4%** of its ticks in JavaScript and the rest in SQLite and the Windows I/O beneath it, so no change to the JS could win more than 4%. Findings tell you what is _shaped_ badly; ticks tell you what is _costing_ you.

## How to write one here

Microbenchmarks lie by default. The failure modes below are the ones that have actually bitten this project, in the order they bit.

### 1. Simulate the interaction, not the function

Ask what the UI calls and how often. `recognize()` looked like "once per character" and is really "once per stroke end, over a growing prefix" — nine calls to draw a nine-stroke kanji. Benchmarking finished characters measured the rarest case and reported the worst moment as if it were typical.

Report the **interaction total**: "59 ms to draw 食" is actionable; "17 ms per recognition" is not.

### 2. Find the cost driver empirically, then vary _that_

Measure candidate variables before designing the input set; keep what moves cost.

| Variable                 | Measured effect | Verdict                             |
| ------------------------ | --------------- | ----------------------------------- |
| Point jitter (0 → 60 px) | 18.2 → 17.1 ms  | Noise. Changes _results_, not work. |
| Stroke count (1 → 9)     | 1.0 → 17.1 ms   | **17×. The driver.**                |

Non-obvious consequences are common: the recognizer's cost curve is **non-monotonic** — 食 (9 strokes, 17 ms) costs more than 議 (20 strokes, 6.7 ms) — because the coarse filter admits patterns within ±2 strokes and the corpus peaks in the middle. "Use a complex character" would have been wrong. Derive the worst case from the data instead: a 9-stroke input admits **863 of 2,213** patterns.

### 3. Know how much the JIT is actually flattering you

Running one input thousands of times gives V8 stable type feedback it would not get from real, varied use — the classic microbenchmark trap ([Vyacheslav Egorov, _Microbenchmarks fairy tale_](https://mrale.ph/blog/2012/12/15/microbenchmarks-fairy-tale.html)). **Measure the effect rather than assuming it**, because it depends entirely on the code:

For the recognizer it is **~3.4%** (17.41 ms repeated vs 18.00 ms varied). The reason is structural: its inputs are `Array<Array<[number, number]>>` at every call, which V8 confirms share one hidden class (`%HaveSameMap` is `true` across characters, strokes, and points). There is no shape polymorphism for repetition to hide, so warming teaches V8 nothing it would not learn in production.

Where this _does_ bite: code taking heterogeneous object shapes — different DTO variants, optional fields, union types. There, repeat one shape and you will benchmark a monomorphic fast path that real traffic never reaches. That is what megamorphic-IC findings are for.

**By contrast, input distribution moved results ~2×** in the same code (7.95 ms for random prefixes vs 8.78 ms for our session mix — random prefixes skew short). For numeric/array-shaped work, choosing a representative distribution matters far more than defeating the JIT.

### 4. Report a distribution, not a mean

An average hides the tail users feel. Track p50/p95/max — the recognizer's mean is unremarkable while its p95 is the moment someone finishes a complex character.

### 5. Keep the result alive

Dead-code elimination will delete work whose result is unused. Consume the return value (accumulate it, or feed it back into the next input) so the compiler cannot optimize the benchmark away.

## Scope

deoptkit's findings only see **JavaScript we wrote**. The dictionary is `node:sqlite`, compiled into Node itself, and the tokenizer is the native `lindera-nodejs` binding — both opaque calls from V8's view — and the webview runs in another process. Their cost still shows up in a tick profile, as shared-library time attributed to the JS that called them, which is how `dictionary.bench.ts` was read. See [docs/specs/07-performance.md](../docs/specs/07-performance.md) for the rest.

`dictionary.bench.ts` needs `assets/jisho.db` and skips without it. Build the **full** dictionary (`vp run build:data:full`) before trusting its numbers: the common-only build is a fifth of the size and flatters every range scan.
