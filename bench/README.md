# Benchmarks

Workloads for profiling with [deoptkit](https://github.com/Saeris/deoptkit). Build the bundle
first — `vp run bench:build` — because deoptkit profiles **built** output: bundling changes object
shapes and inlining, so findings against source describe code that never ships.

```
vp run bench:build
vp exec node bench/recognize.bench.mjs        # run it
# then, via the deopt MCP server:
#   profile_run { command: ["node", "bench/recognize.bench.mjs"] }
#   get_findings { sessionId, fromMark: "recognize_start", toMark: "recognize_end" }
#   list_functions { sessionId }               # where CPU actually goes
```

## How to write one here

Microbenchmarks lie by default. The failure modes below are the ones that have actually bitten this
project, in the order they bit.

### 1. Simulate the interaction, not the function

Ask what the UI calls and how often. `recognize()` looked like "once per character" and is really
"once per stroke end, over a growing prefix" — nine calls to draw a nine-stroke kanji. Benchmarking
finished characters measured the rarest case and reported the worst moment as if it were typical.

Report the **interaction total**: "59 ms to draw 食" is actionable; "17 ms per recognition" is not.

### 2. Find the cost driver empirically, then vary _that_

Measure candidate variables before designing the input set; keep what moves cost.

| Variable                 | Measured effect | Verdict                             |
| ------------------------ | --------------- | ----------------------------------- |
| Point jitter (0 → 60 px) | 18.2 → 17.1 ms  | Noise. Changes _results_, not work. |
| Stroke count (1 → 9)     | 1.0 → 17.1 ms   | **17×. The driver.**                |

Non-obvious consequences are common: the recognizer's cost curve is **non-monotonic** — 食 (9
strokes, 17 ms) costs more than 議 (20 strokes, 6.7 ms) — because the coarse filter admits patterns
within ±2 strokes and the corpus peaks in the middle. "Use a complex character" would have been
wrong. Derive the worst case from the data instead: a 9-stroke input admits **863 of 2,213**
patterns.

### 3. Know how much the JIT is actually flattering you

Running one input thousands of times gives V8 stable type feedback it would not get from real,
varied use — the classic microbenchmark trap ([Vyacheslav Egorov, _Microbenchmarks fairy
tale_](https://mrale.ph/blog/2012/12/15/microbenchmarks-fairy-tale.html)). **Measure the effect
rather than assuming it**, because it depends entirely on the code:

For the recognizer it is **~3.4%** (17.41 ms repeated vs 18.00 ms varied). The reason is
structural: its inputs are `Array<Array<[number, number]>>` at every call, which V8 confirms share
one hidden class (`%HaveSameMap` is `true` across characters, strokes, and points). There is no
shape polymorphism for repetition to hide, so warming teaches V8 nothing it would not learn in
production.

Where this _does_ bite: code taking heterogeneous object shapes — different DTO variants, optional
fields, union types. There, repeat one shape and you will benchmark a monomorphic fast path that
real traffic never reaches. That is what megamorphic-IC findings are for.

**By contrast, input distribution moved results ~2×** in the same code (7.95 ms for random prefixes
vs 8.78 ms for our session mix — random prefixes skew short). For numeric/array-shaped work,
choosing a representative distribution matters far more than defeating the JIT.

### 4. Report a distribution, not a mean

An average hides the tail users feel. Track p50/p95/max — the recognizer's mean is unremarkable
while its p95 is the moment someone finishes a complex character.

### 5. Keep the result alive

Dead-code elimination will delete work whose result is unused. Consume the return value (accumulate
it, or feed it back into the next input) so the compiler cannot optimize the benchmark away.

## Scope

deoptkit only sees **JavaScript we wrote**. The dictionary is a native addon and the tokenizer a
12 MB WASM module — opaque calls from V8's view — and the webview runs in another process. See
[docs/specs/07-performance.md](../docs/specs/07-performance.md) for how those are measured instead.
