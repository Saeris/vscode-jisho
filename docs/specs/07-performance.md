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

## 5. Webview rendering

Different process; deoptkit cannot see it. If a rendering problem appears, use the existing E2E harness with Chrome DevTools (`performance_start_trace` via the devtools MCP, or `page.metrics()`), not V8 logs.

## Open questions

1. **Is recognizer latency actually a complaint?** 17 ms is fast enough to feel instant. The optimization above is worth doing only if handwriting feels laggy in practice — otherwise this benchmark's job is regression-gating, not tuning.
2. **Should `deoptkit ci` gate CI now or later?** Recommendation: later, once the recognizer's algorithmic work is done, so the baseline captures a state we are happy with.
3. **Full-DB benchmarking needs the full DB** — which spec 05's build workflow produces. That sequencing means serious query-performance work lands after the data pipeline.

## Out of scope

Micro-optimizing pure transforms that run once per keystroke on short strings; WASM-internal tokenizer performance (upstream); rewriting the recognizer in WASM (a large change to chase a cost we have not confirmed users feel).
