/**
 * CVD palettes built with the SAME semantic construction as the standard palette.
 *
 * The standard palette maps four semantic clusters onto four 90° quadrants of the hue circle, each
 * subdivided so members sit centred in equal sub-slots. Under dichromacy that circle collapses onto
 * a single axis, so the construction has to be re-projected rather than abandoned:
 *
 *   - CLUSTERS separate by HUE, spread along the surviving axis (measured, not assumed).
 *   - MEMBERS within a cluster separate by LIGHTNESS, because there is no hue left to spend.
 *
 * Measured at L=0.85 C=0.08: adjacent clusters placed along the axis get ΔE ~6-9 from hue alone,
 * while a 0.12 lightness step gives ΔE ~9.6. Neither suffices on its own; together they are
 * additive in OKLab. That is the division of labour below.
 *
 * Surviving axes, measured by finding the widest perceived hue pair under each simulation:
 *   protan  90° ↔ 285°   deutan  90° ↔ 270°   tritan  15° ↔ 225°
 */
import { writeFileSync } from "node:fs";
import Color from "colorjs.io";
import {
  simulate,
  deltaE,
  apca,
  maxChroma,
  toCss,
  toRgbFallback
} from "./color-core.mjs";

const AXIS = {
  protan: [90, 285],
  deutan: [90, 270],
  tritan: [15, 225]
};

/**
 * Cluster order along the axis. Chosen so the pairs that ACTUALLY TOUCH most often in Japanese sit
 * at opposite ends: noun·particle is 41.3% of all boundaries, particle·verb 18.6%. Putting `things`
 * and `actions` at the extremes and `structure` between them means the highest-traffic boundaries
 * get the widest hue separation the axis can offer.
 */
const CLUSTER_ORDER = ["things", "structure", "modifier", "actions"];

const MEMBERS = {
  things: ["noun", "pronoun"],
  structure: ["particle", "utterance"],
  modifier: ["adjective", "adnominal", "adverb"],
  actions: ["verb", "auxiliary"]
};
const ALL = CLUSTER_ORDER.flatMap((c) => MEMBERS[c]);

/**
 * The lightness ladder. Nine rungs, assigned so that categories which are CLOSE IN HUE are FAR
 * APART in lightness — the two channels have to compensate for each other, because on a collapsed
 * hue circle neither can separate everything alone.
 *
 * Built by walking the hue order and alternating between the bottom and top of the ladder
 * (0, 8, 1, 7, 2, 6, …), so consecutive hues are always at opposite ends of the lightness range.
 */
const RUNG = (() => ({
  noun: 0,
  pronoun: 8,
  particle: 3,
  utterance: 6,
  adjective: 1,
  adnominal: 5,
  adverb: 7,
  verb: 2,
  auxiliary: 4
}))();

/** Lightness bands per ground. CVD palettes need a WIDER band than the standard palette: with the
 *  hue circle collapsed, lightness is carrying half the separation rather than none of it. */
const GROUND = {
  dark: { bg: "#39302c", lo: 0.7, hi: 0.94, C: 0.085 },
  light: { bg: "#faf9f8", lo: 0.38, hi: 0.66, C: 0.115 }
};

const build = (view, ground, rungs = RUNG) => {
  const [a, b] = AXIS[view];
  const span = (b - a + 360) % 360;
  const { lo, hi, C } = GROUND[ground];
  const out = {};

  CLUSTER_ORDER.forEach((cluster, ci) => {
    // Cluster centre: evenly along the surviving axis.
    const H = (a + (span * ci) / (CLUSTER_ORDER.length - 1)) % 360;
    const members = MEMBERS[cluster];

    members.forEach((k) => {
      // Members separate by LIGHTNESS. The rung is assigned from a GLOBAL sequence, not per-cluster:
      // an earlier version alternated direction within each cluster, which let members of ADJACENT
      // clusters land on the same rung (adverb/verb collapsed to ΔE 0.5 under deutan — they were
      // near-neighbours in hue AND identical in lightness). Walking one global ladder guarantees
      // every one of the nine colours occupies its own rung.
      const rung = rungs[k];
      const u = rung / (ALL.length - 1);
      const L = lo + (0.06 + 0.88 * u) * (hi - lo);
      const c = Math.min(C, maxChroma(L, H) * 0.96);
      out[k] = new Color("oklch", [L, c, H]);
    });
  });
  return out;
};

const report = (view, ground, cols) => {
  const { bg } = GROUND[ground];
  const ks = Object.keys(cols);
  const seen = Object.fromEntries(ks.map((k) => [k, simulate(cols[k], view)]));
  const ds = [];
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      ds.push({ p: `${ks[i]}/${ks[j]}`, d: deltaE(seen[ks[i]], seen[ks[j]]) });
    }
  }
  const lc = ks.map((k) => apca(cols[k], bg));
  const min = ds.reduce((m, x) => (x.d < m.d ? x : m), ds[0]);
  return {
    min: min.d,
    minPair: min.p,
    mean: ds.reduce((s, x) => s + x.d, 0) / ds.length,
    apcaLo: Math.min(...lc),
    apcaHi: Math.max(...lc)
  };
};

/**
 * The rung ASSIGNMENT is searched, the STRUCTURE is not. Hue placement stays exactly as the
 * semantic construction dictates (four clusters along the surviving axis); only the question of
 * which category takes which lightness rung is optimised — and it is a pure permutation problem
 * with too many interactions to assign by hand (nine categories over four clusters, where members
 * of one cluster share a hue and members of adjacent clusters nearly do).
 */
const searchRungs = (view, ground) => {
  const score = (rungs) => {
    const cols = build(view, ground, rungs);
    const ks = Object.keys(cols);
    const seen = Object.fromEntries(
      ks.map((k) => [k, simulate(cols[k], view)])
    );
    let min = Infinity;
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        min = Math.min(min, deltaE(seen[ks[i]], seen[ks[j]]));
      }
    }
    return min; // maximise the WORST pair
  };
  let best = { rungs: { ...RUNG }, s: score(RUNG) };
  let cur = { ...best.rungs },
    curS = best.s;
  for (let step = 0; step < 4000; step++) {
    const T = 3.2 * (1 - step / 4000) + 0.05;
    const a = ALL[(Math.random() * ALL.length) | 0];
    const b = ALL[(Math.random() * ALL.length) | 0];
    if (a === b) continue;
    [cur[a], cur[b]] = [cur[b], cur[a]];
    const s = score(cur);
    if (s > curS || Math.random() < Math.exp((s - curS) / T)) {
      curS = s;
      if (s > best.s) best = { rungs: { ...cur }, s };
    } else [cur[a], cur[b]] = [cur[b], cur[a]];
  }
  return best.rungs;
};

const out = {};
for (const view of ["protan", "deutan", "tritan"]) {
  out[view] = {};
  for (const ground of ["dark", "light"]) {
    const rungs = searchRungs(view, ground);
    const cols = build(view, ground, rungs);
    const r = report(view, ground, cols);
    out[view][ground] = {
      bg: GROUND[ground].bg,
      css: Object.fromEntries(ALL.map((k) => [k, toCss(cols[k])])),
      rgb: Object.fromEntries(ALL.map((k) => [k, toRgbFallback(cols[k])]))
    };
    console.log(
      `${view}/${ground}: ΔE-as-seen min ${r.min.toFixed(1)} (${r.minPair})  mean ${r.mean.toFixed(1)}  APCA ${r.apcaLo.toFixed(0)}–${r.apcaHi.toFixed(0)}`
    );
  }
}
writeFileSync(
  new URL("./palette-cvd.json", import.meta.url),
  JSON.stringify(out, null, 1)
);
console.log("\nwritten palette-cvd.json");
