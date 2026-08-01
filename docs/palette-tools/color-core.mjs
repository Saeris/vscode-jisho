/**
 * Colour primitives for the POS-palette optimiser.
 *
 * Corrections applied after reading the research (see docs/pos-palette-research.md):
 *   - RELATIVE CHROMA: chroma is expressed as a fraction of the gamut cusp at that L/H, never as an
 *     absolute number. A flat C=0.085 is near-neutral for blue (sRGB ceiling 0.114) while green sits
 *     far below its ceiling (0.245) — a 2x difference in apparent saturation across the palette.
 *     (meodai/skill.color-expert: "Picking a chroma that doesn't exist in the target gamut" is THE
 *     OKLCH mistake; nutelch's relC expresses chroma relative to the shell.)
 *   - CIEDE2000 in Lab-D65 for distance, not Euclidean OKLab. The former is the "gold standard
 *     perceptual distance", the latter merely "good enough" — and this decision is precision-
 *     sensitive. ilikescience/category-colors defaults to ciede2000/lab65 for the same reason.
 *   - GAMUT-MAPPED conversion everywhere. "CSS auto-maps; JS doesn't — oklch→hex just truncates
 *     channels", which shifts HUE. Every conversion here goes through toGamut (chroma-reducing).
 */
import Color from "colorjs.io";

export const GAMUT = "srgb"; // conservative: VS Code webviews may render on non-P3 displays

/** Max in-gamut chroma at a given lightness and hue — the "cusp" for that slice. */
const cuspCache = new Map();
export const maxChroma = (L, H, gamut = GAMUT) => {
  const key = `${gamut}|${Math.round(L * 500)}|${Math.round(H * 2)}`;
  const hit = cuspCache.get(key);
  if (hit !== undefined) return hit;
  let lo = 0,
    hi = 0.45;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (new Color("oklch", [L, mid, H]).inGamut(gamut)) lo = mid;
    else hi = mid;
  }
  cuspCache.set(key, lo);
  return lo;
};

/**
 * Build a colour from RELATIVE chroma: `relC` in 0..1 is the fraction of the achievable chroma at
 * this lightness and hue. relC=0.6 means "60% of the way to the gamut shell" — equally saturated in
 * appearance across every hue, which a fixed absolute chroma can never be.
 */
export const fromRel = (L, relC, H, gamut = GAMUT) =>
  new Color("oklch", [L, maxChroma(L, H, gamut) * relC, H]);

/**
 * OKLCH IS THE SOURCE. Everything below is a FALLBACK for renderers that cannot parse `oklch()`,
 * or a convenience for measurement — never the authoritative value. The distinction matters: the
 * authored palette places six of its eighteen colours outside sRGB deliberately, and treating hex
 * as the source silently discards that.
 */

/** The shipped value: `oklch()`, unclamped. The browser maps to the display's gamut itself. */
export const toCss = (color) => {
  const [L, C, H] = color.to("oklch").coords;
  return `oklch(${(L * 100).toFixed(1)}% ${(C || 0).toFixed(4)} ${(H || 0).toFixed(1)})`;
};

/**
 * Fallback for non-`oklch()` renderers. `rgb()` keeps more precision than hex (no 8-bit-per-channel
 * quantisation), so prefer it. Gamut-mapped by reducing CHROMA — preserving L and H — rather than
 * clipping channels, which would shift hue.
 */
export const toRgbFallback = (color, gamut = GAMUT) => {
  const [r, g, b] = color
    .clone()
    .toGamut({ space: gamut, method: "css" })
    .to("srgb").coords;
  const c = (x) => (clamp01(x) * 255).toFixed(1).replace(/\.0$/, "");
  return `rgb(${c(r)} ${c(g)} ${c(b)})`;
};

/** Hex fallback — lossiest form; for tooling that accepts nothing else. */
export const toHex = (color, gamut = GAMUT) =>
  color
    .clone()
    .toGamut({ space: gamut, method: "css" })
    .to("srgb")
    .toString({ format: "hex" });

// ── Colour-vision deficiency ────────────────────────────────────────────────
// Brettel–Viénot–Mollon linear-RGB projection. colorjs.io ships no CVD simulation.
const CVD_MATRIX = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998]
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881]
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039]
  ]
};

/**
 * Prevalence among people of northern-European descent, used to WEIGHT the CVD terms rather than
 * treating the three as equals. Deuteranomaly is ~30x more common than tritanopia; an optimiser
 * that weights them equally spends its budget on the rarest condition.
 */
export const CVD_PREVALENCE = {
  normal: 1.0,
  deutan: 0.06,
  protan: 0.02,
  tritan: 0.0003
};
export const VIEWS = ["normal", "deutan", "protan", "tritan"];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * CVD simulation. The Brettel–Viénot–Mollon matrices are defined on LINEAR RGB, so we convert to
 * `srgb-linear` — but we do NOT gamut-map first. An earlier version clamped into sRGB before
 * projecting, which quietly discarded the very wide-gamut chroma we are trying to evaluate. Values
 * outside sRGB stay as unclamped floats through the projection; only the final display step maps.
 */
export const simulate = (color, kind) => {
  if (kind === "normal") return color;
  const M = CVD_MATRIX[kind];
  const lin = color.clone().to("srgb-linear").coords;
  const out = M.map((r) => r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]);
  return new Color("srgb-linear", out);
};

/** CIEDE2000 in Lab-D65 — the precision metric, per the research. Operates on floats, no clamping. */
export const deltaE = (a, b) => a.deltaE(b, "2000");

/** Lightness distance in CIELAB (0..100), used for the grayscale/CVD-independent channel. */
export const lightnessDistance = (a, b) =>
  Math.abs(a.to("lab-d65").coords[0] - b.to("lab-d65").coords[0]);

/**
 * APCA contrast against a ground. Takes Colors and compares them directly — an earlier version
 * round-tripped through `toHex`, quantising to 8 bits per channel AND clamping wide-gamut values
 * into sRGB before measuring. Contrast is computed on the colour as authored.
 */
export const apca = (color, ground) =>
  Math.abs(
    new Color(color).contrast(
      typeof ground === "string" ? new Color(ground) : ground,
      "APCA"
    )
  );

// ── Colour naming ───────────────────────────────────────────────────────────
/**
 * Berlin & Kay's basic chromatic terms as OKLCH hue bands. Heer & Stone's probabilistic model —
 * built on ~3M XKCD naming judgements — REPLICATES these categories, so anchoring here is not an
 * approximation of that dataset; it is the equilibrium that dataset converges to.
 *
 * Boundaries adapted to OKLCH from the named-hue ranges in meodai/skill.color-expert.
 */
export const NAME_BANDS = [
  { name: "red", from: 15, to: 45 },
  { name: "orange", from: 45, to: 75 },
  { name: "yellow", from: 75, to: 120 },
  { name: "green", from: 120, to: 168 },
  { name: "teal", from: 168, to: 215 },
  { name: "blue", from: 215, to: 285 },
  { name: "purple", from: 285, to: 325 },
  { name: "pink", from: 325, to: 355 },
  { name: "crimson", from: 355, to: 15 }
];

export const nameOf = (H) => {
  const h = ((H % 360) + 360) % 360;
  for (const b of NAME_BANDS) {
    if (b.from < b.to ? h >= b.from && h < b.to : h >= b.from || h < b.to) {
      return b.name;
    }
  }
  return "red";
};
