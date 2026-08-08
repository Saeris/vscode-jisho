# Kana stroke-order SVGs

Per-character stroke-order animation SVGs for hiragana and katakana (one file per literal, e.g. `あ.svg`), rendered by the stroke-order view when a kana is tapped on the Kana chart (#55 step 3).

Same format as `../kanji-svgs` and produced by the same transform (`scripts/build-strokes.ts`) — glyph / defs / strokes / guides, no embedded `<style>`.

## Why these are a separate directory

**Licensing.** AnimCJK splits its own terms: the kanji glyphs derive from the Arphic PL KaitiM fonts and carry the **Arphic Public License**, while the kana in its `svgsJaKana` set are **LGPL v3 or later**. One directory holding both would mean one license file that is wrong for half its contents, so the two sets are kept physically apart and each ships the terms that actually govern it.

These files are LGPL — see `LGPL.txt`, and `ANIMCJK-COPYING.txt` for AnimCJK's full split. Like the APL, the LGPL here is file-scoped: bundling this data into the MIT-licensed extension does not relicense the extension.

## Coverage

The 46 modern base kana plus ゐ/ゑ, the 25 voiced and semi-voiced kana, and every one of those in katakana — 146 files, derived from the chart in `src/shared/kana-chart.ts` so a cell added there cannot end up without a drawing.

**Digraphs are absent by design.** きゃ is two code points, and a drawing is served by one-code-point filename; upstream has no combined drawing for them either. The chart makes digraph cells inert to match.

## Upstream quirks the transform has to handle

Two things differ from the kanji set. Both produced files that looked structurally fine while being wrong on screen, so they are worth knowing before touching `build-strokes.ts`.

**Split strokes.** A stroke that crosses itself is painted as **two clipped fragments** sharing one stroke number — あ's third is `c3a` + `c3b`. Measured, both carry the same `--d:3s` and their medians are identical from the crossing onward, differing only in a lead-in displaced ~740 units in x: one stroke drawn in two halves, each clipped to the part a single swept median would leak outside of. Kanji never do this. 7 of 28 sampled kana are affected (あ お す な ぬ の ば).

Both fragments therefore **render**, sharing a stamped `--stroke` ordinal so counting, numbering and guiding treat them as one. Keeping only one fragment leaves the stroke visibly unfinished (this shipped once); counting them separately animates あ as four strokes. Guides come from the **first** fragment — the trailing one's lead-in sits off-canvas at x = -170.

**Implicit lineto, and decimal ordinates.** Kanji medians write `M677 114L731 160` with integer coordinates; kana write `M 111.6,323.2 174,363.7` — one `M`, bare pairs, and decimals. Two separate bugs came out of that:

- A parser matching on the command letter finds a single point, and one point has no direction, so kana originally shipped with start numerals and **no direction arrows**.
- An integer-only number pattern does not skip a decimal point, it matches **across** it: `111.6,323.2` parses as `6,323`, and the stray `.2` pairs with the next number. お's first stroke became a guide doubling back on itself at x≈2, drawn as a vertical bar at the canvas edge.

The parser now reads decimal coordinate pairs. `build-strokes.spec.ts` pins both with real お coordinates.

## Maintenance

Regenerate with `vp run build:strokes`, which rebuilds both directories from the pinned AnimCJK SHA in `scripts/acjk.ts`. Do not edit these by hand.
