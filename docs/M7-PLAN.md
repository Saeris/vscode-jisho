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

### As-built (item 1)

- **License gate PASSED with AnimCJK** (not the KanjiVG fallback — user preference). Researched: AnimCJK's kanji glyph SVGs are **Arphic Public License (APL)**; kana/stroke SVGs are LGPL. The APL is file-scoped copyleft with an **LGPL-style aggregation clause** (§2), so bundling the SVGs as a DB data column does **not** relicense the MIT extension — same posture as our existing EDRDG/CC-BY-SA data. `ARPHICPL.TXT` + `ANIMCJK-COPYING.txt` + `LGPL.txt` ship unaltered in `assets/kanji-svgs/` (APL §1), credited in About + README. Saved to agent memory.
- **Source = a vendored copy, not an npm dep.** The Japanese-subset SVGs (3,821 chars, named by literal, e.g. `食.svg`) are copied into `assets/kanji-svgs/` from the author's guide-to-japanese customization — these carry a **local guides layer** (per-stroke start-point circles + direction arrows) on top of AnimCJK's stroke geometry, which is our own pedagogical content over the animation layer (not a modification of the Arphic-derived glyph paths). A future build script will regenerate this shape from AnimCJK source for re-sync; for now the vendored files are the maintained source.
- **Delivery = DB table, per plan.** `stroke_svgs(literal, svg)` (PK on literal, exact-match lookup); ingested verbatim by the build's stroke pass. **Size: +31.8 MB raw on the common DB** (SVG text with the guides layer is verbose), but gzips to ~29.4 MB total DB — the SVG portion compresses heavily (repetitive path syntax). Acceptable for the download-delivered DB; watch the full DB total on the M-final rebuild.
- **Playback:** `getStrokeSvg` message → `strokeSvgQuery` → `StrokePlayer.tsx` injects the SVG (trusted, from our DB) and drives it via the **`strokePlayerMachine`** (idle/playing/paused/stepped; play/pause/replay/step). The SVG's own inline CSS animates strokes; the component pauses it by default (`animation-play-state: paused` unless `data-playing`), so the machine is the controller and there's **no autoplay** — combined with a `prefers-reduced-motion` override that rests on the fully-drawn frame. Replay remounts via a `runId` key to restart CSS animations. Machine unit-tested (`strokePlayer.spec.ts`, 5 tests); `db.spec` guards the SVG lookup (食 → clip-path markup; non-kanji → null).
- **Deferred to a follow-up:** the `sibling-index()`/`sibling-count()` CSS refactor (drops the hardcoded per-stroke `--d` delays) needs a structural SVG change (wrap strokes in a `<g>`) that belongs in the AnimCJK-source transform script — shipped item 1 uses the proven inline-`--d` SVGs as-is first.

## 2. Handwriting search (perfect-freehand + KanjiCanvas)

Reserved decisions from M1 (docs/M1-PLAN.md §Reserved): **capture** with [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (pretty variable-width strokes), **recognition** with [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) (MIT, offline, stroke-order-and-count free — suits learners). The shared currency is raw stroke data `Array<Array<[x, y]>>` — retain it; perfect-freehand only _renders_ it, KanjiCanvas _consumes_ it.

- **Adapt KanjiCanvas:** upstream is a global-object script (`kanji-canvas.min.js` + `ref-patterns.js`, in the repo's `docs/resources/javascript/`). Vendor the recognition core + patterns into `src/webview/vendor/kanjicanvas/` as ES modules (decouple from its canvas/DOM helpers — we only need the pattern-matching function fed with normalized strokes). The ref-patterns file is ~1MB JS — it lives in the webview bundle; measure the bundle impact and lazy-load the drawing view's chunk (dynamic `import()` — Vite code-splits automatically).
- **Drawing view:** new machine view `handwriting` reachable from the search bar (✏️ affordance). Pointer-event capture on an SVG/canvas box (pointerdown/move/up → stroke points), rendered via perfect-freehand's `getStroke`; undo-last-stroke + clear buttons. On each stroke end, run recognition and show the top ~8 candidate kanji as tappable chips; tapping **appends** the character to the search query and returns to search (mirroring Shirabe's flow).
- All of this is webview-side (recognition is pure JS on stroke arrays) — no host/message changes.

**Success:** draw 食 (sloppily, wrong stroke order) → 食 appears among candidates → tap → search shows 食-words + the kanji section. Component-level test for the stroke-capture → candidate pipeline with a recorded stroke fixture; visual/UX pass in F5.

### As-built (item 2)

- **Recognizer = a ground-up functional rewrite, not a vendored blob** (user direction). KanjiCanvas's reference is a pre-ES6 global-object script with shared mutable state + DOM coupling; we **reverse-engineered** the algorithm (Wakahara et al. one-to-one stroke correspondence) and rebuilt it as pure typed functions in `src/webview/recognizer/` (`types` · `geometry` moment-normalize/resample · `correspondence` distance metrics + N/M-N stroke map · `index` pipeline). Maintained internally; may externalize as a package later.
- **Fidelity pinned by ported reference tests** (not synthetic mimicry). `correspondence.spec.ts` ports the reference's own documented `testMap` outputs (`test_k2`/`k21..23` → `[0,0,1,1]`/`[0,0,0,1]`/`[0,1,1,1]`) — which **caught a real transcription bug** (a `k1`/`k2` mix-up in `completeMap`'s split metric). `recognize.spec.ts` runs end-to-end on the real patterns (a char's own strokes rank top-3; relaxed from top-1 because visually near-identical pairs like 日/曰 legitimately tie under aspect-normalization). 7 recognizer tests total.
- **Patterns = a lazy 6.7MB chunk.** `ref-patterns.js` (6.7MB, not the plan's ~1MB estimate) → converted to a typed `patterns.ts` data module, loaded via dynamic `import()` only when the handwriting view runs recognition. Build confirms code-splitting: `patterns-*.js` **6.4MB (2.3MB gz) as its own chunk**, `recognizer-*.js` ~4KB, **base `index.js` unchanged at 449KB**. The vendored `.orig.js` sources were deleted after reimplementation; only `KANJICANVAS-LICENSE.TXT` is retained for attribution.
- **Drawing view:** `Handwriting.tsx` — pointer-capture strokes rendered with **perfect-freehand** (added as a dep), undo/clear, top-8 candidate chips. Tapping a chip **appends** the char to the query and returns to search (new `appendToSearch` nav event + `handwriting` view; ✏️ affordance in the search toolbar). All webview-side; no host/message changes. Stroke order/count free.
- **Attribution:** KanjiCanvas (MIT — the notice's required GitHub backlink is in About + README) + perfect-freehand (MIT), credited in About, README, and `src/webview/recognizer/README.md`.
- **Item 3 (radical picker):** already shipped in M4 — nothing to do here.

## 3. Radical-based lookup (if it slipped from M4)

If M4 deferred its radical picker, it lands here — see M4-PLAN item 4; it complements handwriting as the other "I can see it but can't type it" input mode.

## Build order & verification

1 (stroke order — includes the license gate) → 2 (handwriting) → 3 (radical picker if pending). Per-item commits + bump files (both headline items are `minor`). Standing gates per CONVENTIONS; webview bundle size before/after recorded for item 2; F5 passes for both (animation smoothness, drawing latency). Append as-built + flip ROADMAP status.
