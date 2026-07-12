# Handwriting recognizer

A **functional, typed reimplementation** of the [KanjiCanvas](http://github.com/asdfjkl/kanjicanvas) online handwriting-recognition algorithm (© 2019 Dominik Klein, MIT — `KANJICANVAS-LICENSE.TXT`), itself an implementation of Wakahara et al.'s stroke-number/stroke-order-free recognition as a _one-to-one stroke correspondence problem_.

We did **not** vendor the original code. It's a pre-ES6 global-object (`KanjiCanvas.foo = function(){…}`) script with shared mutable scratch state and DOM/canvas coupling. Instead we reverse-engineered the algorithm from the reference and rebuilt it as pure functions over immutable typed data — maintained internally (and potentially externalized as a package later).

## Layout

- `types.ts` — `Point`, `Stroke`, `Pattern`, `RefPattern`, `StrokeMap`, `DistanceMetric`.
- `geometry.ts` — preprocessing: moment normalization (into a 256×256 box, ARAN aspect correction) + interval feature resampling.
- `correspondence.ts` — stroke distance metrics (endpoint / initial / whole-whole) and the one-to-one stroke-correspondence map (`getMap` greedy + hill-climb, `completeMap` M–N).
- `index.ts` — the pipeline: `recognize(strokes, refPatterns)` → normalize → features → coarse classification → fine classification → ranked candidate characters.
- `patterns.ts` — decodes the reference stroke patterns from a compact binary blob into `RefPattern[]`. **Lazy-loaded** via dynamic `import()` so it never enters the base bundle.
- `patterns.data.ts` — the patterns as base64 of a compact binary blob (do not hand-edit). Base64-inline because the webview CSP blocks fetching an asset file. This replaced an ~8MB JS array literal: the built chunk went 6.4MB→1.8MB (2.3MB→1.25MB gz), and decoding a flat `ArrayBuffer` is far cheaper for parse time and heap than a giant nested literal. It is the **canonical committed source** for the patterns.

### Binary format (little-endian)

```
u32 entryCount
per entry:
  u16 charCode        (all reference chars are single BMP code units)
  u16 strokeCount     (canonical stroke count)
  u16 actualStrokes   (number of stroke arrays that follow)
  per stroke:
    u16 pointCount
    (f32 x, f32 y) × pointCount   (coords are post-moment-normalization floats)
```

Regenerating the patterns (e.g. adding characters via re-extraction from KanjiCanvas/source) needs a re-extract + re-encode tool — tracked in [BACKLOG.md](../../../docs/BACKLOG.md) alongside the AnimCJK-source transform (#21). The `patterns.ts` decoder is the authoritative reader of this format.

## Fidelity

The rewrite's correctness is pinned by tests **ported from the reference's own documented behaviour**:

- `__tests__/correspondence.spec.ts` — the `test_k2`/`test_k21..23` stroke-correspondence maps whose exact expected outputs are documented in the original `testMap` block. (These caught a real transcription bug during the rewrite — a `k1`/`k2` mix-up in the map completion.)
- `__tests__/recognize.spec.ts` — end-to-end: a character's own reference strokes must recognize as itself (top-3), on the real pattern data.

## Attribution

Recognition algorithm & reference patterns: KanjiCanvas (Dominik Klein, MIT — http://github.com/asdfjkl/kanjicanvas; the MIT notice requires this backlink). Drawing capture: perfect-freehand (Steve Ruiz, MIT). Both credited in the in-app About view and the README.
