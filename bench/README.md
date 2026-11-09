# Benchmarks

Two kinds of benchmark live here, answering two different questions. Both matter; neither replaces the other.

|           | `*.bench.ts` (Vitest)                  | `*.bench.mjs` (deoptkit)                    |
| --------- | -------------------------------------- | ------------------------------------------- |
| Question  | **Did my change make it faster?**      | **Why is this slow?**                       |
| Output    | ops/sec, percentiles, margin of error  | inline-cache states, deopts, where ticks go |
| Use it to | gate regressions, compare before/after | decide what to optimize                     |

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

There are two ways in, and they suit different workloads.

### The Vitest benches under deoptkit — for "where does the time go?"

```
vp run bench:profile                                   # every bench, V8-logged
vp run bench:profile -- bench/dictionary.bench.ts -t "refineCounts"   # narrowed
```

This runs the same `*.bench.ts` cases with deoptkit's Vitest preset (deoptkit 0.2+, Vitest 5): one V8 log per worker in `.deopt/`, a `manifest.json` for the MCP server's `load_manifest`, and a `findings.json` that `deoptkit lsp` shows as editor diagnostics. Every case is wrapped in `benchObserved`, so each has `<name>_start`/`<name>_end` window markers. It is a separate mode from `bench:compare` on purpose — logging slows every case, so a baseline recorded under it would make every later comparison read as a regression.

**Narrow what is logged for anything heavy.** The preset logs every category by default, which means an inline-cache event per property access for as long as a case runs. Profiling `refineCounts` that way wrote **8.4 GB** before it was stopped, and the JS-only benches together passed 6 GB. For ticks alone — the question that usually matters — set:

```
DEOPTKIT_CATEGORIES=deopts,profile,sources vp run bench:profile -- bench/dictionary.bench.ts
vp exec node --prof-process .deopt/v8-<pid>.log      # the worker whose log holds your window
```

The worker that ran a case is the log containing its marker: `grep -l "__DEOPT_MARK__refineCounts_noun" .deopt/*.log`.

### The `*.bench.mjs` workloads — for "is anything shaped badly?"

```
vp run bench:build                                   # profiles BUILT output: bundling changes shapes
vp exec deoptkit ci --out-dir .deopt bench/examples.bench.mjs   # structural findings vs baseline
vp exec deoptkit ci --update --out-dir .deopt <script.mjs>      # accept the current findings
```

These run a **fixed** iteration count through deoptkit's `observed()` harness, so their logs stay bounded with every category on — which is why they still exist alongside the Vitest benches. Folding them in is possible, but only once the profile mode caps iterations the same way.

With the deopt MCP server connected (deoptkit's plugin), `profile_run` / `get_findings` / `list_functions` answer the same questions interactively; `load_manifest` loads a `bench:profile` run.

`.deopt/baselines/` **is committed**, unlike `bench/baselines/`, and the difference is the point: throughput is a property of the machine, while a megamorphic IC or a deopt loop is a property of the code. So findings port across machines and can gate; ops/sec cannot. The baselines were re-recorded for deoptkit 0.2.0, which keys an `obj[key]` site by code position rather than by runtime key — so the old baselines reported the same sites as "new" and "no longer occurring" at once. All four workloads matched on a second run on the same machine.

`deoptkit ci` **is a CI gate** (the `deopt` job in `ci.yml`): a new finding in any of the four workloads fails the build. It runs on **Node 26**, not the extension host's 24.22, because the workloads cannot run on Node 24 at all — the bundle they load includes the handwriting recognizer, whose patterns decode with `Uint8Array.fromBase64` (Chromium 148 and Node 25+ only). When a finding is expected (a refactor can move one: wrapping the tokenizer build in `lazy()` changed the map-churn finding's function name from empty to `buildTokenizer`), accept it with `vp exec deoptkit ci --update --out-dir .deopt <workload>` and commit the baseline in the same change.

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
