# Handwriting recognizer

A **functional, typed reimplementation** of the [KanjiCanvas](http://github.com/asdfjkl/kanjicanvas) online handwriting-recognition algorithm (© 2019 Dominik Klein, MIT — `KANJICANVAS-LICENSE.TXT`), itself an implementation of Wakahara et al.'s stroke-number/stroke-order-free recognition as a _one-to-one stroke correspondence problem_.

We did **not** vendor the original code. It's a pre-ES6 global-object (`KanjiCanvas.foo = function(){…}`) script with shared mutable scratch state and DOM/canvas coupling. Instead we reverse-engineered the algorithm from the reference and rebuilt it as pure functions over immutable typed data — maintained internally (and potentially externalized as a package later).

## Layout

- `types.ts` — `Point`, `Stroke`, `Pattern`, `RefPattern`, `StrokeMap`, `DistanceMetric`.
- `geometry.ts` — preprocessing: moment normalization (into a 256×256 box, ARAN aspect correction) + interval feature resampling.
- `correspondence.ts` — stroke distance metrics (endpoint / initial / whole-whole) and the one-to-one stroke-correspondence map (`getMap` greedy + hill-climb, `completeMap` M–N).
- `index.ts` — the pipeline: `recognize(strokes, refPatterns)` → normalize → features → coarse classification → fine classification → ranked candidate characters.
- `patterns.ts` — the reference stroke patterns extracted from KanjiCanvas (~6.7MB data; **lazy-loaded** via dynamic `import()` so it never enters the base bundle).

## Fidelity

The rewrite's correctness is pinned by tests **ported from the reference's own documented behaviour**:

- `__tests__/correspondence.spec.ts` — the `test_k2`/`test_k21..23` stroke-correspondence maps whose exact expected outputs are documented in the original `testMap` block. (These caught a real transcription bug during the rewrite — a `k1`/`k2` mix-up in the map completion.)
- `__tests__/recognize.spec.ts` — end-to-end: a character's own reference strokes must recognize as itself (top-3), on the real pattern data.

## Attribution

Recognition algorithm & reference patterns: KanjiCanvas (Dominik Klein, MIT — http://github.com/asdfjkl/kanjicanvas; the MIT notice requires this backlink). Drawing capture: perfect-freehand (Steve Ruiz, MIT). Both credited in the in-app About view and the README.
