# Milestone 7 Plan — Stroke order & handwriting

> **Status:** planned. The drawing milestone: animated stroke order on the kanji detail view, and draw-to-search handwriting recognition. Both build on decisions reserved since M1. Read [CONVENTIONS.md](CONVENTIONS.md) first. Depends on M4 (kanji detail view exists).

## Context

Two independent features sharing a theme but **deliberately decoupled data**: stroke-order _display_ uses AnimCJK's per-character SVGs; handwriting _recognition_ uses KanjiCanvas's own reference patterns. Neither depends on the other's data, so they ship separately.

## 1. Stroke-order animation (AnimCJK)

**Source:** [parsimonhi/animCJK](https://github.com/parsimonhi/animCJK) — `svgsJa/` holds ~7,000 SVGs (jōyō + jinmeiyō + hyōgai kanji, components, kana strokes), one file per character named by **decimal** Unicode codepoint (e.g. 食 = U+98DF = `39135.svg`). Each SVG embeds per-stroke paths, dashed "median" paths, and CSS animations.

**License gate (do first):** verify animCJK's current data license (historically GPL-adjacent/Arphic-derived terms have applied to CJK glyph datasets). If the SVG data's license is incompatible with bundling into our MIT-licensed extension's data artifact, fall back to KanjiVG (CC BY-SA 4.0, same per-char SVG model, slightly less robust — the original M1 source list before we swapped). Record the determination in the as-built and extend attribution accordingly.

**Build/delivery:** add a `stroke_svgs(literal, svg)` table to the data build (fetch the repo archive once, extract `svgsJa`). ~7k SVGs at a few KB each ≈ 20–40MB — measure; gzip-compressing each SVG text in the column is worth testing (Turso stores BLOBs; decompress host-side with `zlib`). Ships in the same DB + `dictionary-latest` refresh.

**Playback:** a new `getStrokeSvg(literal)` message feeds `KanjiDetail`. Playback control is the **XState animation-player machine** the stack was chosen for: states `idle/playing/paused` + `step`/`replay` events, driving the SVG's animation via CSS class toggles and `animation-delay` manipulation (AnimCJK's own demo shows the pattern — study `index.html`/`lib.php` in the repo). Controls: play/pause, step-through, replay; respect `prefers-reduced-motion` (don't autoplay). Machine is pure UI state → unit-test transitions like the navigation machine.

**Success:** kanji detail for 食 shows the character drawing itself stroke by stroke with working play/pause/step; machine tests green; DB size delta recorded.

## 2. Handwriting search (perfect-freehand + KanjiCanvas)

Reserved decisions from M1 (docs/M1-PLAN.md §Reserved): **capture** with [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (pretty variable-width strokes), **recognition** with [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) (MIT, offline, stroke-order-and-count free — suits learners). The shared currency is raw stroke data `Array<Array<[x, y]>>` — retain it; perfect-freehand only _renders_ it, KanjiCanvas _consumes_ it.

- **Adapt KanjiCanvas:** upstream is a global-object script (`kanji-canvas.min.js` + `ref-patterns.js`, in the repo's `docs/resources/javascript/`). Vendor the recognition core + patterns into `src/webview/vendor/kanjicanvas/` as ES modules (decouple from its canvas/DOM helpers — we only need the pattern-matching function fed with normalized strokes). The ref-patterns file is ~1MB JS — it lives in the webview bundle; measure the bundle impact and lazy-load the drawing view's chunk (dynamic `import()` — Vite code-splits automatically).
- **Drawing view:** new machine view `handwriting` reachable from the search bar (✏️ affordance). Pointer-event capture on an SVG/canvas box (pointerdown/move/up → stroke points), rendered via perfect-freehand's `getStroke`; undo-last-stroke + clear buttons. On each stroke end, run recognition and show the top ~8 candidate kanji as tappable chips; tapping **appends** the character to the search query and returns to search (mirroring Shirabe's flow).
- All of this is webview-side (recognition is pure JS on stroke arrays) — no host/message changes.

**Success:** draw 食 (sloppily, wrong stroke order) → 食 appears among candidates → tap → search shows 食-words + the kanji section. Component-level test for the stroke-capture → candidate pipeline with a recorded stroke fixture; visual/UX pass in F5.

## 3. Radical-based lookup (if it slipped from M4)

If M4 deferred its radical picker, it lands here — see M4-PLAN item 4; it complements handwriting as the other "I can see it but can't type it" input mode.

## Build order & verification

1 (stroke order — includes the license gate) → 2 (handwriting) → 3 (radical picker if pending). Per-item commits + bump files (both headline items are `minor`). Standing gates per CONVENTIONS; webview bundle size before/after recorded for item 2; F5 passes for both (animation smoothness, drawing latency). Append as-built + flip ROADMAP status.
