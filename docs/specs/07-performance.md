# Spec 07 — Benchmarking and performance strategy

**Backlog:** new (#41). **Status:** pilot run, workflow proven, strategy proposed. A working benchmark exists (`bench/recognize.bench.mjs`) — the numbers below are measured, not projected.

## The shape of the problem

Three performance surfaces, and **they need different tools**. Reaching for one tool everywhere is the main risk here:

| Surface                                      | Cost lives in           | deoptkit sees it?    | Right tool                       |
| -------------------------------------------- | ----------------------- | -------------------- | -------------------------------- |
| Handwriting recognizer                       | pure JS/TS we wrote     | ✅ fully             | **deoptkit**                     |
| Ruby/spacing/furigana/conjugation transforms | pure JS/TS we wrote     | ✅ fully             | deoptkit (low value — see below) |
| Dictionary queries                           | native addon (Turso)    | ❌ opaque call       | **SQL-level work** (§4)          |
| Tokenizer                                    | 12 MB WASM (Lindera)    | ❌ opaque call       | upstream/config only             |
| Webview rendering                            | Chromium, other process | ❌ different process | Chrome DevTools via E2E          |

deoptkit answers "why is this JS slow" — inline-cache states, deopts, hidden-class churn. It is the right tool for exactly one of our heavy paths, and that path is real user-facing work.

## Designing a benchmark that is worth running

The first version of this benchmark looped `recognize()` over finished characters. It ran, it profiled, and it was **misleading** — worth recording why, because the failure mode generalizes:

- It measured only **completed** characters. The UI recognizes on _every stroke end_, so most real recognitions are of **partial** input — a half-drawn character that matches nothing well.
- It **averaged over a hand-picked list**, which hid both the peak cost and its cause.
- It reported "17 ms per recognition" as if that were typical. It is the _worst_ moment (the final stroke of a complex character), not the common one.

What replaced it: a simulated **drawing session** — for each sample character, the growing stroke prefixes the UI actually feeds the recognizer (1 stroke, then 2, …).

Two things were measured before designing it, rather than assumed:

| Variable                 | Effect on cost          | Conclusion                                                                                                                                      |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Point jitter (0 → 60 px) | 18.2 → 17.1 ms (noise)  | Irrelevant. It changes _results_, not work — the algorithm walks the same candidates regardless of match quality. Belongs in correctness tests. |
| **Stroke count**         | **1.0 → 17.1 ms (17×)** | **The cost driver.** The coarse filter admits patterns within ±2 strokes, and the corpus peaks in the middle.                                   |

The stroke-count curve is also **non-monotonic** — 食 (9 strokes, 17 ms) costs more than 議 (20 strokes, 6.7 ms) — so "use a complex character" would have been the wrong heuristic. Computed over the real corpus: a **9-stroke input admits 863 of 2,213 patterns**, the analytic worst case. The sample set spans the curve and includes that peak deliberately.

## Pilot results (measured 2026-07-19)

**The user-facing number**: drawing 食 (9 strokes) costs **59 ms of recognition total**, across nine calls that grow 0.5 ms → 16.8 ms. Per-stroke latency stays inside a ~16 ms frame budget until stroke 8 — so lag, if felt at all, is confined to the last strokes of a complex character.

Profiled with `profile_run` → `get_findings` → `list_functions`:

**Where the time is** (session benchmark: 1,223 ticks, 96% in JS):

| Function           | self ticks        | share   |
| ------------------ | ----------------- | ------- |
| `endPointDistance` | 608               | **50%** |
| `initialDistance`  | 207               | 17%     |
| `getMap`           | 137 (1,051 total) | 11%     |
| everything else    | < 2% each         |         |

The realistic benchmark _sharpened_ this: `endPointDistance` rose from 45% (finished characters only) to 50%, because partial inputs spend proportionally more time in the coarse filter and less in the fine pass.

**What the findings say**: 4 eager deopts (severity 48, "wrong map" / "insufficient type feedback") and polymorphic ICs (severity 36–44) on `map`, `push`, `length` in `coarseClassification`/`fineClassification`. **No megamorphic ICs, no deopt loops** — the code is already reasonably well-shaped.

**The load-bearing observation: the findings and the ticks disagree.** The flagged sites sit in `coarseClassification`/`fineClassification`, which own ~19 self-ticks (1.5%) between them. The 67% living in `endPointDistance` + `initialDistance` produced _no_ findings — they are tight arithmetic over typed data, already monomorphic. So:

- **Fixing every deoptkit finding here would be a rounding error.** Shape work is worth doing where ticks are, and the ticks are elsewhere.
- **The real win is algorithmic**: the coarse filter calls `endPointDistance` once per admitted candidate — up to 863 of them at the worst stroke count. Cutting the _candidate set_ (tighter pre-filtering, early termination once the best distance cannot be beaten) attacks 50% of runtime directly. That is ordinary optimization, not V8 work.

This is the pilot's real value: it told us _not_ to spend a day on inline caches.

## 0. Two benchmark kinds, two questions

deoptkit explains **why** a path is slow; it cannot tell you whether a change helped. That needs
throughput, so both exist side by side in `bench/`:

|         | `*.bench.ts` (Vitest bench)                     | `*.bench.mjs` (deoptkit)       |
| ------- | ----------------------------------------------- | ------------------------------ |
| Answers | Did my change make it faster?                   | Why is this slow?              |
| Output  | ops/sec, p75/p99, margin of error               | ICs, deopts, CPU ticks         |
| Command | `vp run bench` / `bench:save` / `bench:compare` | `profile_run` → `get_findings` |

Vitest's bench mode already provides the before/after workflow (`--outputJson` + `--compare`), so
this needed configuration rather than tooling. Current baseline on the recognizer:

| Case                                     | ops/sec | mean    |
| ---------------------------------------- | ------- | ------- |
| session: draw 食 (9 strokes, worst case) | 16.5    | 60.7 ms |
| session: draw 水 (4 strokes, typical)    | 171     | 5.8 ms  |
| single: 1 stroke                         | 4,105   | 0.24 ms |
| single: 9 strokes (peak candidate set)   | 55.9    | 17.9 ms |
| single: 20 strokes                       | 147     | 6.8 ms  |

**Noise floor, measured**: re-running identical code moved individual cases by up to **9%**
(`[0.91x] ⇓` with no change), with `rme` typically ±1–4%. Treat sub-10% deltas as noise unless they
reproduce. Baselines are gitignored because they are machine-specific — comparing against CI's
hardware would measure the hardware.

Two configuration traps worth knowing, both hit while wiring this up:

- Vitest runs `*.bench.*` in **every project whose patterns match**, so the benchmark initially ran
  four times (unit, component, browser, bench) — including in a real browser, which the numbers do
  not claim to describe. Fixed by scoping the scripts with `--project bench`.
- The `benchmark.include` option is separate from `include`; the bench project sets both, so the
  deoptkit `*.bench.mjs` workloads (which export no Vitest suite) are not collected as benches.

## 0.5 The optimization, verified (2026-07-19)

The workflow's first real use, and it worked exactly as designed: profile → identify → change → compare.

**What the profile said**: `endPointDistance` held 50% of CPU. It reads only four numbers per stroke (first and last point) but `getMap` calls it **~840,000 times** for one worst-case recognition, each call re-walking stroke → point → coordinate to find them again.

**The change** (`correspondence.ts`, `index.ts`): precompute each pattern's endpoints once into a flat `Float64Array`, cache the reference set's (immutable, shared across every recognition — a `WeakMap` keyed on the array identity), and give the coarse pass a specialised `getMapEndPoints` that does flat array arithmetic instead of calling a metric. Same algorithm, same comparisons, same order — only the data layout changed. The generic `getMap` stays for the fine pass, which uses a metric that genuinely needs whole strokes.

**Measured result** (`vp run bench:compare`, all far beyond the ~10% noise floor):

| Case                          | Before  | After   | Speedup   |
| ----------------------------- | ------- | ------- | --------- |
| single: 20 strokes            | 6.7 ms  | 3.8 ms  | **1.76×** |
| single: 9 strokes (peak)      | 17.5 ms | 10.1 ms | **1.73×** |
| session: draw 食 (worst case) | 61.5 ms | 42.5 ms | **1.45×** |
| session: draw 水 (typical)    | 5.8 ms  | 4.8 ms  | 1.20×     |

User-facing latency: **p95 22.5 ms → 12.8 ms**, and total profile ticks 1,223 → 699 (43% less CPU).

**The profile confirms the mechanism**: `endPointDistance` fell from 608 self-ticks (50%) to 23 (3%) — V8 inlined the specialised comparison into `getMapEndPoints`. Correctness is unchanged: 228 tests pass, including the recognizer's ported reference-fidelity tests, plus 8/8 E2E.

## 0.6 A rejected optimization, and why (2026-07-19)

The obvious next lever was the fine pass's **top-100 candidate cutoff** — an unexamined constant inherited from the KanjiCanvas reference, gating the now-dominant `getMap`. Measuring first killed it, which is the point of measuring.

**The tempting evidence**: across 130 corpus-sampled characters, distorted with jitter plus scale and skew to mimic an uneven hand, the correct answer never ranked below **4th** in the coarse pass. That suggests ~96 of the 100 fine evaluations cannot change the answer, and cutting to 25 keeps an 8× margin.

**What that measurement missed**: it asked whether the _correct answer_ survives, not whether the _candidate list_ does. Capturing full top-8 outputs across 315 characters before and after:

- top-1 answer unchanged in **272 of 274** changed cases — the headline accuracy holds
- but **87% of candidate lists changed** (only 41/315 identical)

The handwriting panel shows **eight chips** and the user picks from them. The coarse ranking is a crude endpoint metric; the fine pass genuinely reorders far down the list, so those "wasted" evaluations are exactly what makes chips 2–8 trustworthy. A ~1.2× speedup is not worth degrading the visible result set — especially since a user reaches for chips 2–8 precisely when their handwriting was poor, i.e. when the coarse ranking is least reliable.

Reverted, with the reasoning recorded at `FINE_CANDIDATES` so the next person does not re-derive it.

## 0.7 Allocation, not algorithm (2026-07-19)

The plan after 0.5 was to flatten `initialDistance` the way `endPointDistance` had been flattened. Re-reading the profile first killed that plan too, and pointed at something better.

`initialDistance` **does not appear in the profile at all** — V8 had inlined it into `getMap`. There was no function left to optimize. What the profile did show was `ArrayFrom` at **92 of 697 ticks (13%)**, trailed by `FastCreateDataProperty`, `GrowFastSmiOrObjectElements`, and `CloneFastJSArrayFillingHoles`: pure allocation overhead, invisible in source review.

Both map builders allocate two arrays per candidate comparison, and the coarse pass compares hundreds of candidates per stroke — a 9-stroke input admits 863 patterns, so **~1,726 array allocations per stroke drawn**. `Array.from({ length: n }, () => -1)` runs a callback per element through the generic iteration protocol; `new Array(n).fill(-1)` writes the backing store directly. The `free` boolean array became a zero-filled `Uint8Array` (inverted to `taken`, so the allocator's zero fill _is_ the initial state).

Measured: **1.11×–1.59×** across the five cases, ticks 697 → 562, p50 4.4 → 3.6 ms, and all four allocation builtins gone from the top functions. Top-8 candidate lists over 317 distorted characters are byte-identical — unlike the cutoff change, this one is arithmetic-identical by construction.

**The lesson worth keeping**: the biggest remaining win was not in the metric everyone was looking at. Re-profile after every change rather than executing the plan the previous profile suggested — optimizing shifts the bottleneck, and sometimes deletes the target outright.

**Remaining targets**, now that ~58% of ticks sit in the two map builders (`getMapEndPoints` 178, `getMap` 150) and allocation is handled:

- The **coarse pass** is the larger share and is still `O(n²)` per candidate over hundreds of candidates. A cheaper pre-filter (bounding-box or centroid distance) could reject candidates before any map is built — this is an algorithmic change, so it would need the same output-diff verification, and it _can_ change results.
- The recognizer is now comfortably fast (p95 ~11 ms, well inside a frame budget for per-stroke feedback). Further work here is optional; the honest next perf question was the **30 s cold start** from §0.2 — now diagnosed and fixed in §0.8 (54.6 s → 2.4 s).

## 1. Keep the benchmark, use it as a regression gate

`bench/recognize.bench.mjs` + `bench/entry.ts` (a bundle entry, because deoptkit profiles **built** output — bundling changes shapes and inlining, so findings against source describe code that never ships). Build with `vp run bench:build`.

Adopt `deoptkit ci` once the recognizer is optimized, not before: baselines are identity-only structural findings, so committing `.deopt/baselines/` makes "no new megamorphic sites" a guarded invariant — valuable _after_ a known-good state exists, noise before.

## 2. Extend coverage where it pays

Add benchmarks only for paths that are both hot and ours:

- **`recognize`** — done. Current baseline: **p50 6.8 ms, p95 22.5 ms** across a realistic session mix. The p95 is what a user feels (finishing a complex character); the mean hides it.
- ~~**`addFurigana` / `addSpacing` over a realistic document**~~ — **measured, not worth a benchmark.** A 200-line mixed EN/JA document (the shape of the user's lesson material) annotates in **24 ms total, 0.12 ms/line**, and it is a one-shot user-invoked command rather than a per-keystroke path. `removeFurigana` is sub-millisecond. Revisit only if documents get an order of magnitude larger.
- **`provideSemanticTokens`** — the remaining strong candidate: it runs over every visible line on every edit (debounced), so unlike the furigana commands its cost recurs while typing. Benchmark against a long document, and report p95.

Do **not** bench `conjugate`, `ruby`, `pitch`: they run once per user interaction on tiny inputs. Correctness matters there; nanoseconds do not.

**Methodology lives in [`bench/README.md`](../../bench/README.md)** — the rules below in full, with the measurements behind each. Read it before adding a benchmark.

### Rules for writing one (learned from getting it wrong first)

1. **Simulate the interaction, not the function.** Ask what the UI actually calls and how often. The recognizer looked like "one call per character" and is really "one call per stroke, over a growing prefix" — a 9× difference in what gets measured.
2. **Find the cost driver empirically before choosing inputs.** Measure a few candidate variables; keep the one that moves cost. Here jitter was noise (<1 ms) and stroke count was 17×. Guessing would have produced a benchmark that looks realistic and measures nothing.
3. **Include the analytic worst case, and derive it.** For the recognizer the corpus itself says 9 strokes admits the most candidates (863/2,213) — and the curve is non-monotonic, so intuition ("pick a complex character") picks wrong.
4. **Report the interaction total, not the per-call average.** "59 ms to draw 食" is actionable; "17 ms per recognition" describes only the final stroke and reads as if it were typical.
5. **Vary shapes, not just values.** Uniform inputs warm a single hidden class and hide exactly the polymorphism deoptkit exists to find.

## 3. Startup performance (separate, already instrumented)

Commit `e193fa7` added a "Jisho" log channel timing activation, DB provisioning/opening, and tokenization. That is the instrument for the reported ~30 s first-search delay; deoptkit is the wrong tool (the cost is I/O and WASM init, not JS shapes).

Known structural issue to fix regardless of what the log says: **`search` awaits `analyzeQuery` (tokenizer init) before querying, while `searchNames` tokenizes nothing** — so a tokenizer stall presents exactly as "names appear before vocabulary." Run the DB query and tokenization concurrently and merge lemmas when they land.

## 4. Database performance (the other avenue)

Out of deoptkit's reach, and probably our largest remaining win. Approach:

- **Measure first**: time each query in `db.ts` against the FULL database (the dev DB is the 22k-entry common subset — 20× smaller than what users get, so dev timings systematically understate). Add the timings to the log channel.
- **`EXPLAIN QUERY PLAN`** every search query; confirm the `idx_search_term` / `idx_search_term_lower` indexes are actually used and no scan sneaks in at full scale.
- **Known N+1**: `NamesDictionary.searchNames` issues one `#nameResult` round trip per result row. Fast today (8–22 ms) because the dev names DB is warm and local; worth a single-query rewrite before it matters.
- **Ranking cost**: the search `CASE` ladder computes per row; check whether it is a meaningful share at 3M `search_terms` rows.
- Caveat: Turso is not upstream SQLite, so its planner may differ — verify rather than assume SQLite lore applies.

### Measured at full scale (2026-07-24, the 217,974-word DB with F1 sentences + F3 similar-kanji)

Ran against the built `assets/jisho.db` (variant=full, 189,292 sentence rows). All comfortably within the <150 ms budget — the F1/F3 additions did NOT regress query latency:

| Query                                                    | p50     | p95     | max     |
| -------------------------------------------------------- | ------- | ------- | ------- |
| `search("食べる")` (exact word)                          | 3.2     | 4.7     | 4.7     |
| `search("はなします")` / `search("たべる")` (deinflect)  | ~3.5    | ~4      | ~4      |
| `search("study")` (gloss)                                | 21.0    | 32.3    | 32.3    |
| `search("猫")` / `search("水")` (single common kanji)    | 27 / 53 | 39 / 66 | 39 / 66 |
| `search("生")` (broadest single kanji)                   | 69.3    | 86.2    | 86.2    |
| `getWord(食べる)` (now reads inline F1 sentences)        | 1.4     | 5.4     | 5.4     |
| `getKanji(食)` / `getKanji(未)` (now reads F3 `similar`) | 14 / 10 | 20 / 11 | 20 / 11 |

- **`EXPLAIN QUERY PLAN`** on the exact-term path: `SEARCH search_terms USING INDEX idx_search_term (term=?)` — the index is used, no table scan at full scale.
- The slowest searches are single-common-kanji queries (生, 水) that legitimately match thousands of compound words; still under the budget. If they ever bother, that's a ranking/LIMIT tuning question, not an index problem — **the reserved Turso `fts_match` upgrade is NOT needed for v1.**
- `getWord` is unchanged by F1: it reads only `source='tanaka'` (≤3/sense). `getKanji` picked up F3's similarity read at negligible cost (one indexed lookup). This **closes open question 3** (full-DB benchmarking) — the pipeline produced the full DB, it was measured, and search is responsive.

## 5. Webview rendering

Different process; deoptkit cannot see it. If a rendering problem appears, use the existing E2E harness with Chrome DevTools (`performance_start_trace` via the devtools MCP, or `page.metrics()`), not V8 logs.

## Open questions

1. **Is recognizer latency actually a complaint?** 17 ms is fast enough to feel instant. The optimization above is worth doing only if handwriting feels laggy in practice — otherwise this benchmark's job is regression-gating, not tuning.
2. **Should `deoptkit ci` gate CI now or later?** Recommendation: later, once the recognizer's algorithmic work is done, so the baseline captures a state we are happy with.
3. **Full-DB benchmarking needs the full DB** — which spec 05's build workflow produces. That sequencing means serious query-performance work lands after the data pipeline.

## 0.8 The cold start, solved (2026-07-19)

**54,641ms → 2,381ms** from activation to last step, first search from ~41s to 1.8s. The path there is worth recording, because every intermediate conclusion was wrong in an instructive way.

**What the durations said, and why they lied.** The first trace credited `provision dictionary` with 21.3s. Every filesystem call it makes measures ~1ms; the version check correctly skips the copy; `connect()` is 4ms and "taberu" returns in 1ms. Four spans also began at the _same millisecond_ and finished 8s apart, and a `setTimeout(2000)` fired at 17,034ms.

That last number is the one that cracked it. A timer 15s late means nothing on the thread ran for 15s. `await` means "queued", not "running": on the extension host's single JS thread, a span accrues wall clock for whatever else monopolises the thread while it waits, and **duration alone cannot separate work from queueing**. This is how a 1ms filesystem check got billed 21 seconds — and how an earlier, correct measurement ("the DB opens in 4ms") produced a wrong conclusion ("the DB is exonerated").

**The fix was measurement, not optimization.** Adding an event-loop heartbeat turned the ambiguity into a direct reading:

```
event-loop stalls: 8 over 100ms, 8438ms blocked in total
blocked time is 80% of the traced window
```

**The blocker was never ours.** The dev workspace had **168 installed extensions**, and VS Code runs all of them in one Node process on one JS thread; any extension doing synchronous work at activation stalls every other extension. A session screenshot even caught one failing to activate mid-search. This also explains the discrepancy that had been visible for three sessions and repeatedly misread: **E2E was always fast because the harness passes `--disable-extensions`.** The launch config now does too.

**Three code changes survived the diagnosis**, all of which help shipped users rather than only the dev loop:

1. **Names sequenced behind words.** Both queries shared one postMessage channel into a single-threaded host, so racing them made every names message a turn the word search waited behind — with the 409MB names DB answering first while the words the user asked for arrived seconds later.
2. **Word dictionary warmed** (names deliberately not), taking provisioning off the first search's critical path.
3. **Tokenizer warmup moved to sidebar-open**, not activation. `activationEvents` is empty, so the hover/semantic-token providers activate this extension on _any_ markdown or plaintext file — warming a blocking build there would inflict 197ms on someone who just opened a README.

**What could not be fixed.** The tokenizer's `build()` is one uninterruptible WASM call: a 5ms heartbeat gets **zero** ticks across its ~197ms. It cannot be chunked or yielded from our side, so the only lever is _when_ it lands. The follow-up trace proved the point — the user searched at 1,777ms and beat the 2,000ms warmup, which then stalled the thread twice _after_ the results were on screen. A warmup that fires after the work it was meant to warm is strictly worse than none.

**Generalizable lessons:**

- A fast component measurement does not exonerate that component. It only rules out _its own work_ — never the queue it sits in.
- When several spans start in the same millisecond and finish far apart, they are not measuring themselves.
- Instrument the gaps, not just the steps. The gap and stall columns found in one trace what four sessions of component benchmarking had missed.

## 0.9 Tokenizer deopt profile — the WASM boundary, confirmed (2026-07-20)

With the novel-length corpus in place (spec 08), profiled `segment()` and the highlight walk over the whole of 吾輩は猫である with deoptkit (`bench/tokenize.bench.mjs`). This settles what is and isn't ours to optimize.

**One finding, severity 10, and it is in the benchmark harness** (a `.length` access in the profile's own loop), not our code. The tick breakdown over 2,107 samples:

| Where the time goes                                                                                                                             | self-ticks | share   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- |
| Lindera's WASM (`wasm-function[N]`)                                                                                                             | ~800+      | ~40%    |
| JS↔WASM boundary (`CreateTypedArray`, `TypedArrayPrototypeSubArray`, `decode`/TextDecoder, `wasm-to-js`, wasm-bindgen `__wbg_*`/`__wbindgen_*`) | ~240       | ~11%    |
| **Our JavaScript** (`segment` folding 15, `stripRuby` 2, `japaneseRuns` ~0)                                                                     | **~17**    | **<1%** |

**Our own code is under 1% of the profile.** The folding loop, ruby stripping, and run detection do not register. There is nothing in the JS we wrote to optimize — as predicted (a WASM tokenizer is opaque to V8), the cost is Lindera's WASM plus the marshalling wasm-bindgen generates to move strings and typed arrays across the boundary. Both are upstream.

**The only lever that is ours** is the _number of boundary crossings_. The ~11% boundary cost scales with call count: the highlight walk calls `segment()` once per Japanese run (many per line), the plain pass once per line. Fewer, larger calls would amortize the per-call encode/allocate — but the profile shows that is an ~11% ceiling on an already-fast path (whole novel in ~4s, and a real document is far shorter), so it is not worth pursuing now. Recorded so the next person does not re-derive it.

**Lesson (again):** the profile confirmed the up-front hypothesis rather than overturning it — but running it was still right, because "it's all WASM" was a guess until the tick breakdown made it a measurement, and it also surfaced the exact boundary builtins, which is what a future optimization (if ever warranted) would target.

## 0.10 Deinflection deopt profile — a clean shape fix (2026-07-20)

`deinflect()` runs on every search before the SQL query, and it is pure JS — the one unbenched hot path the coverage assessment flagged (`bench/deinflect.bench.{ts,mjs}`).

**Cost driver, measured before benchmarking:** chain DEPTH, not branch width. Each derivation step re-scans all ~90 rules over the frontier, so a query that normalizes through intermediate forms (なかった → ない → verb stems) is the worst class. Spread: 0.49 µs (no-match noun) to 8.3 µs (negative chain), 17×. The obvious guess — broad branching (られる) is worst — was wrong; it is wide but shallow, so cheap (1.3 µs). This is why the inputs were measured first.

**The path is fast** (40 profile ticks for 200k calls), but the profile found one real, actionable shape issue: the `IRREGULAR` irregular-verb table was a **plain object indexed by the query string**, so its lookup went **megamorphic** — V8 treats each distinct string key as a shape transition and gives up on a fast path. deoptkit reported ~43 such sites (one per key seen).

**Fix:** `IRREGULAR` became a `Map`, the purpose-built string→value structure, whose lookup is monomorphic. `compare_sessions` verdict: **megamorphic sites 43 → 0, nothing introduced**; the remaining polymorphic `.length`/`.endsWith`/`.slice` sites are inherent (those methods read off both strings and arrays in the hot loop). Throughput moved 1.03–1.07× across all cases — within the ~10% noise floor, so reported as "not a regression" rather than a claimed win; the real, unambiguous result is the shape improvement. 46 tests confirm identical output.

**Lesson:** a plain object used as a string-keyed hash map is always megamorphic on that access; reach for `Map` when the keys are data (arbitrary strings), not code (a fixed known set). When a profile hands you a clean shape win at no behavioral cost, take it even if the throughput delta is in the noise.

## Out of scope

Micro-optimizing pure transforms that run once per keystroke on short strings; WASM-internal tokenizer performance (upstream); the JS↔WASM marshalling cost (wasm-bindgen-generated, ~11% and only reducible by batching calls — see §0.9); rewriting the recognizer in WASM (a large change to chase a cost we have not confirmed users feel).
