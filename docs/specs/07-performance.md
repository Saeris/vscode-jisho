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

## Pilot results (measured 2026-07-19)

`recognize()` against the real 2,213 reference patterns: **17 ms per recognition warm**, 37 ms cold. That runs while a user is drawing, so it is felt.

Profiled with `profile_run` → `get_findings` → `list_functions`:

**Where the time is** (1,042 ticks, 97% in JS):

| Function           | self ticks      | share |
| ------------------ | --------------- | ----- |
| `endPointDistance` | 472             | 45%   |
| `initialDistance`  | 228             | 22%   |
| `getMap`           | 125 (910 total) | 12%   |
| everything else    | < 4% each       |       |

**What the findings say**: 12 findings — 4 eager deopts (severity 48, "wrong map" / "insufficient type feedback"), 8 polymorphic ICs (severity 36–44) on `map`, `push`, `length` in `coarseClassification`/`fineClassification`. **No megamorphic ICs, no deopt loops** — the code is already reasonably well-shaped.

**The load-bearing observation: the findings and the ticks disagree.** The flagged sites sit in `coarseClassification`/`fineClassification`, which own ~20 self-ticks (~2%) between them. The 67% living in `endPointDistance` + `initialDistance` produced _no_ findings — they are tight arithmetic over typed data, already monomorphic. So:

- **Fixing every deoptkit finding here would be a rounding error.** Shape work is worth doing where ticks are, and the ticks are elsewhere.
- **The real win is algorithmic**: `endPointDistance` is called ~2,213× per recognition by the coarse filter. Cutting the _candidate set_ (a cheaper pre-filter — stroke-count bucketing, early termination once the best distance can't be beaten) attacks 45% of runtime directly. That is ordinary optimization, not V8 work.

This is the pilot's real value: it told us _not_ to spend a day on inline caches.

## 1. Keep the benchmark, use it as a regression gate

`bench/recognize.bench.mjs` + `bench/entry.ts` (a bundle entry, because deoptkit profiles **built** output — bundling changes shapes and inlining, so findings against source describe code that never ships). Build with `vp run bench:build`.

Adopt `deoptkit ci` once the recognizer is optimized, not before: baselines are identity-only structural findings, so committing `.deopt/baselines/` makes "no new megamorphic sites" a guarded invariant — valuable _after_ a known-good state exists, noise before.

## 2. Extend coverage where it pays

Add benchmarks only for paths that are both hot and ours:

- **`recognize`** — done.
- **`addFurigana` / `addSpacing` over a realistic document** — these walk every line, tokenize, and splice. The tokenizer call is opaque, but our splicing and `stripRuby` index-mapping are not, and they run over whole files.
- **`provideSemanticTokens`** — runs over every visible line on every edit (debounced), and its per-morpheme walk is ours.

Do **not** bench `conjugate`, `ruby`, `pitch`: they run once per user interaction on tiny inputs. Correctness matters there; nanoseconds do not.

**Input variety is mandatory.** The pilot samples ten characters spanning 1–20 strokes precisely so the coarse filter's ±2 window admits different candidate-set sizes. A loop over one input warms a single hidden class and hides the polymorphism the tool exists to find.

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
