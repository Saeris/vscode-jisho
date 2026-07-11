# Kanji stroke-order SVGs

Per-character stroke-order animation SVGs (one file per literal, e.g. `食.svg`), ingested into the dictionary DB's `stroke_svgs` table by the data build and animated on the kanji detail view.

## Provenance & license

These SVGs are derived from **[AnimCJK](https://github.com/parsimonhi/animCJK)** (© 2016-2026 FM&SH), which itself adapts glyph outlines from the **Arphic PL KaitiM** fonts, the **[Makemeahanzi](https://github.com/skishore/makemeahanzi)** project, and the **Unihan** database.

The **stroke path / glyph geometry is under the [Arphic Public License](ARPHICPL.TXT) (APL)** — see `ARPHICPL.TXT` (kept unaltered here per APL §1) and `ANIMCJK-COPYING.txt` for AnimCJK's full license split (kanji glyphs = APL; kana/stroke SVGs = LGPL, see `LGPL.txt`). The APL is file-scoped copyleft with an LGPL-style aggregation clause (§2), so bundling this SVG data into the MIT-licensed extension does not relicense the extension — only this data carries the APL.

## Local customizations (not font-derived)

On top of AnimCJK's stroke geometry we add a **guides layer** — per-stroke start-point circles and direction arrows (the `<g class="guides">` group and its `guide-fade` CSS). This is our own pedagogical content authored over the animation layer, not a modification of the Arphic-derived glyph paths.

## Maintenance

These are a **vendored copy** — AnimCJK is a data repository, not an npm dependency, and the APL requires the license to travel with the data. Only the Japanese subset we need is kept here. A future build script will regenerate this shape directly from the AnimCJK source so it can be re-synced from the authoritative upstream.
