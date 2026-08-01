# Palette tools

Generators behind the part-of-speech palettes. Kept so every number in
[`../pos-palette-research.md`](../pos-palette-research.md) is reproducible rather than asserted.

These are **research scripts, not part of the extension build** — they are not referenced by
`vite.config.ts`, run in CI, or shipped in the `.vsix`. Run them by hand from this directory when
the palette changes.

## Prerequisites

```sh
npm install colorjs.io      # the only dependency
```

## Running

```sh
node cvd-quadrants.mjs      # rebuild the three CVD palettes  → palette-cvd.json
node gen-palettes.mjs       # render the two review documents
```

`gen-palettes.mjs` writes absolute paths to `docs/pos-palettes.md` and
`docs/pos-palettes-review.md`; adjust them if the repo moves.

## Files

| file                                | role                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color-core.mjs`                    | OKLCH primitives, gamut cusp, CVD simulation, CIEDE2000, APCA. **`oklch()` is the source of truth**; `toRgbFallback` and `toHex` exist only as fallbacks for renderers that cannot parse it. |
| `authored.mjs`                      | The hand-authored standard palette — exact `oklch()` values — plus the quadrant construction that generates them.                                                                            |
| `cvd-quadrants.mjs`                 | Re-projects that construction onto each dichromacy's surviving hue axis. Searches the lightness-rung assignment; never the structure.                                                        |
| `gen-palettes.mjs`                  | Renders the deliverable and the simulation-review document.                                                                                                                                  |
| `adjacency.json`                    | 672,371 measured part-of-speech transitions from the shipped corpus.                                                                                                                         |
| `samples.json`                      | The tokenized sample sentences and paragraph used in every preview.                                                                                                                          |
| `palette.json` / `palette-cvd.json` | Generated palette values (`oklch()` source + `rgb()` fallback).                                                                                                                              |

## A note on precision

Do not reintroduce hex as an intermediate. Six of the authored palette's eighteen colours sit
outside sRGB deliberately; round-tripping through hex quantises to 8 bits per channel _and_ clamps
those values, which silently changed a flat chroma of 0.08 into an uneven 0.075–0.081 in an earlier
revision. Measure from the `oklch()` source.
