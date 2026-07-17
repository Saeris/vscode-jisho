# Stroke order: architecture & lessons

How the stroke-order player and chart work, why they are built this way, and the traps we hit building them. Inline comments in the code point here instead of retelling these stories — this file is where the context lives, so the code can stay terse.

References that shaped the design: [dmak](https://mbilbille.github.io/dmak/) for the playback/seek _behaviour_ (its pure-JS implementation is a 2014 workaround — CSS could not do dash-offset animation then; ours can), Duolingo's kanji quizzes for median-aligned direction guides, Kanji Look & Learn for numbered start markers, and [KanjiVG](https://kanjivg.tagaini.net/) as a cross-check for stroke/radical structure (CC BY-SA — reference only, never merged).

## Data pipeline

```
AnimCJK upstream (pinned SHA, svgsJa)
  → scripts/build-strokes.ts     strip embedded <style>, group into glyph/strokes/guides, regenerate guides
  → assets/kanji-svgs/*.svg      3,821 files, Arphic Public License (ARPHICPL.TXT ships alongside)
  → packaged into the .vsix      read by the host per request (getStrokeSvg → readFile)
  → webview                      <StrokePlayer> / <StrokeChart> inject the markup and style it
```

The SVGs ship as **files in the extension package**, not rows in `jisho.db`. They used to live in a `stroke_svgs` table because `assets/**` is `.vscodeignore`d and the downloaded database was the only delivery vehicle — but that meant `build:strokes` (regenerates files) and `build:data` (ingested them) had to be run _together_, and forgetting the second step left the extension rendering stale SVGs while every file-reading test passed. Files-in-package removes the sync step entirely and decouples stroke fixes from dictionary releases.

## The SVG format (what the transform emits)

```
<svg class="acjk" viewBox="0 0 1024 1024">
  <g class="glyph">    filled outline shapes — the faint "where strokes go" underlay
  <defs>               clip paths + the guide arrowhead marker
  <g class="strokes">  the animated medians, and NOTHING else
  <g class="guides">   per stroke: numbered marker (①…) + two direction-arrow variants
  <g class="parts">    invisible per-component hit rects (only when acjk data exists)
```

Load-bearing details:

- **`g.strokes` contains only the medians** so `sibling-index()` _is_ the stroke number. In the AnimCJK source the medians are siblings of `<style>`, `<defs>` and the fills, so stroke 1 reports index 11.
- **`pathLength="3333"`** on every median normalises stroke length, so `stroke-dasharray`/`stroke-dashoffset` are constants — nothing is measured at runtime (the thing dmak needed JS for).
- **No embedded `<style>`.** The source's stylesheet starts animating the moment the markup hits the DOM and cannot be stopped from outside — the original autoplay bug. The app owns every rule.
- **Guide elements carry their stroke number as `--gs`** (inline). A guide is 1 element for a dot-only stroke and 3 otherwise, so deriving the number from DOM position breaks; emitting it doesn't.
- **Two guide-arrow variants per stroke**: `aligned` traces the median (Duolingo style); `offset` sits clear of the stroke using the heading-classification + offset table ported from guide-to-japanese's `addGuidelines.ts`. `--guide-offset` (0–1) cross-fades between them at runtime.
- **Start markers are circled numerals** ①–㉙ (`U+2460–2473`, then `U+3251+` for 21+). Max stroke count in the set is 29 (鬱); glyph coverage was probed in the real webview — all render.
- The guide-offset port preserves an apparent bug in the original: `Math.round(360 / 2π) = 57` rounds the radians→degrees _constant_ before multiplying. The H/V/O heading thresholds were hand-tuned against those skewed values across thousands of characters, so "fixing" the maths would silently reclassify strokes near every boundary. Match the tuned behaviour, not the textbook formula.
- **Parts** come from dictionaryJa.txt's `acjk` field (`願⿰原10頁.9` — drawing-order components with stroke counts, `.` = radical, `:` = a split run of the same component, e.g. 国's 囗 drawn 1–2 then 8). The transform stamps every stroke _and_ glyph path with `--part:N` inline (glyph too, so highlight works on undrawn strokes), and emits one `<rect>` per part sized to its strokes' median bounds + padding — **largest-first**, so an enclosing part paints under its contents and the inner part wins hit-testing. Parts are stamped only when the acjk stroke total and the glyph count both agree with the median count; on any mismatch the group is omitted (silently absent beats silently wrong). Rects carry `data-part`/`data-literal`/`data-radical`, `role="button"` and `tabindex="0"` — they're the feature's pointer _and_ keyboard surface. The player highlights via one delegated handler writing `--hl-part` on the canvas; CSS does the rest with the chart's `abs()` equality idiom (`--part` registers with initial `-1` so unstamped paths never match the resting `0`).

## The player

One number drives everything: `--stroke-index`, the playhead, registered via `@property` as an inheriting `<number>`.

- **The clock** is a single Web Animation created by the component with `element.animate()` — animating `--stroke-index` from 0 to the stroke count over `strokeCount × MS_PER_STROKE`, created paused (autoplay is impossible by construction), held by direct reference. Play, pause, replay, and seek are `play()`, `pause()`, `currentTime` — the browser's own playhead, not a hand-rolled one.
- **CSS renders from the playhead.** Each median computes its own progress — `clamp(0, playhead − (strokeNumber − 1), 1)` — and maps it onto `stroke-dashoffset`. Continuous arithmetic, so exactly one stroke is mid-draw at any playhead value, and the draw-on animates smoothly. (A conditional here is wrong by construction: two possible output values means strokes snap instead of drawing.)
- **Guides** show only for the stroke being drawn next: `--gs` compared against the playhead with an `if()` two-bound gate (a genuine step function — the one place a conditional is the right tool). The gate lands in a variable (`--gs-visible`) that the variant cross-fade multiplies, because a second `opacity` rule would override the gate instead of combining with it.
- **Invariant: whenever the clock is paused, `currentTime` is a whole-stroke multiple.** Pause snaps down to the last completed stroke, so the picture, the clock, and the slider always agree while at rest.
- **React state is minimal**: `playing`, plus the slider's controlled value in _whole strokes_, mirrored from the clock. The Web Animations API has no progress event, so a rAF loop follows the running clock to move the handle.
- **Slider**: `onChange` fires on every pointer move (scrub); `onChangeEnd` fires on release (commit). The controlled value must be exactly what the slider reported — deriving it desyncs React Aria's drag state, and at 0 specifically a same-value `setState` is a React bail-out (no re-render), which is why the thumb used to stick only at that end.
- **Reduced motion**: play/replay call `finish()` instead of animating; seeking still works stroke-by-stroke.

## The chart

Each cell injects the same SVG and sets `--stroke-index` to its own number — the identical rendering rules freeze it at that position, no animation involved. The newest stroke (number == playhead, integers by construction) is highlighted via `clamp(0, 1 − abs(playhead − strokeNumber), 1)` feeding a `color-mix()`. Guides are `display: none` in cells; the cell's own number label carries the ordering.

## Lessons (the expensive ones)

1. **Regenerated assets must have exactly one delivery path.** The files-vs-DB split let unit tests (reading files via `?raw`) pass while the extension (reading the DB) rendered stale data — the symptoms looked like broken CSS, and it cost the longest debugging session of the feature.
2. **CSS Modules vs injected DOM.** Markup injected via `dangerouslySetInnerHTML` has literal class names; any selector into it must be wrapped in `:global(...)` _for its full depth_ — `:global(svg.acjk) .strokes` still hashes `.strokes`. Keyframe names are hashed too, and `animation-name: :global(x)` is a **parse error** (`:global` is selector syntax) that silently reverts the whole build to stale output.
3. **`@property` registration is what makes a custom property a number.** Unregistered, `var(--x)` in `calc()` is token substitution; expressions with `sibling-index()` inside simply drop the declaration. Register anything used in arithmetic.
4. **`if()` limits**: `style()` queries compare a custom property against a _literal_ (or a registered var), support `>=`/`<=` but not equality against a computed value like `sibling-index()`; and a conditional's discrete outputs cannot animate. Use it for genuine step functions only; use `clamp()`/`abs()` arithmetic for anything continuous.
5. **WAAPI semantics**: `pause()` holds position, `play()` resumes (and auto-rewinds a finished animation); setting `currentTime` while running does _not_ pause; there is no progress event — poll with `requestAnimationFrame`. Own the `Animation` object directly instead of fishing it back out of `getAnimations()`.
6. **Tests must assert behaviour, not mechanism.** Two broken players shipped behind green suites: one asserted "3 strokes drawn after 3 arrow presses" (also true if every input restarts the animation and it races to 3); one counted only fully-drawn strokes (blind to a player that snaps strokes instead of drawing them). The current suite asserts: inputs don't restart, seeks land paused, the handle advances by itself, partial dash offsets exist mid-draw, and multiple seek positions each show exactly the right strokes.
7. **Pin upstreams.** `downloadAndUnzipVSCode("stable")` re-resolves per E2E run; AnimCJK is fetched by commit SHA. A moving upstream turns a green suite red with no code change.

## Licensing

The SVG paths derive from the Arphic PL KaitiM fonts via AnimCJK, so they carry the **Arphic Public License** — file-scoped copyleft with an LGPL-style aggregation clause, bundleable into this MIT extension. `ARPHICPL.TXT` ships next to the SVGs and the transform stamps each file with the notice. `dictionaryJa.txt` (component/radical stroke ranges, used for the planned radical highlighting) is from the same project under the same licence.
