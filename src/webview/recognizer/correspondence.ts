/**
 * Stroke distance metrics and the one-to-one stroke-correspondence map (Wakahara et al.). Pure
 * functions reimplemented from the KanjiCanvas reference (see types.ts). The map assigns each stroke
 * of the larger pattern to a stroke of the smaller, minimizing total stroke distance, then completes
 * an M–N (many-to-one) map so patterns with different stroke counts can be compared.
 */
import type { DistanceMetric, Pattern, Stroke, StrokeMap } from "./types";

const manhattan = (a: readonly number[], b: readonly number[]): number =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Distance between two strokes' endpoints (first↔first + last↔last). Cheap coarse metric. */
export const endPointDistance: DistanceMetric = (a, b) => {
  const l1 = a.length;
  const l2 = b.length;
  if (l1 === 0 || l2 === 0) return 0;
  return manhattan(a[0], b[0]) + manhattan(a[l1 - 1], b[l2 - 1]);
};

/**
 * A pattern's endpoints flattened to `[firstX, firstY, lastX, lastY]` per stroke.
 *
 * `endPointDistance` reads only those four numbers, but `getMap` calls it ~840,000 times for a
 * single worst-case recognition — each call re-reading `a.length`, then indexing three levels deep
 * (stroke → point → coordinate) to find them again. Extracting them once per stroke turns the hot
 * comparison into flat Float64Array arithmetic with no property loads at all.
 */
export type EndPoints = Float64Array;

export const endPointsOf = (pattern: Pattern): EndPoints => {
  const out = new Float64Array(pattern.length * 4);
  for (let i = 0; i < pattern.length; i++) {
    const stroke = pattern[i];
    const last = stroke.length - 1;
    const base = i * 4;
    // A zero-length stroke would have no endpoints; the metric treats those as distance 0, and
    // callers filter them out before this point (recognize() drops strokes shorter than 2 points).
    if (last < 0) continue;
    out[base] = stroke[0][0];
    out[base + 1] = stroke[0][1];
    out[base + 2] = stroke[last][0];
    out[base + 3] = stroke[last][1];
  }
  return out;
};

/** `endPointDistance` over precomputed endpoints — same value, no property loads. */
const endPointDistanceAt = (
  a: EndPoints,
  ai: number,
  b: EndPoints,
  bi: number
): number => {
  const p = ai * 4;
  const q = bi * 4;
  return (
    Math.abs(a[p] - b[q]) +
    Math.abs(a[p + 1] - b[q + 1]) +
    Math.abs(a[p + 2] - b[q + 2]) +
    Math.abs(a[p + 3] - b[q + 3])
  );
};

/** Point-by-point distance over the shorter stroke, scaled by the length ratio. */
export const initialDistance: DistanceMetric = (a, b) => {
  const lmin = Math.min(a.length, b.length);
  const lmax = Math.max(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < lmin; i++) dist += manhattan(a[i], b[i]);
  return dist * (lmax / lmin);
};

/**
 * Order two sequences as `[longer, shorter, nLonger, mShorter]` (n ≥ m). Generic because the
 * algorithm applies it both to strokes (sequences of points) and patterns (sequences of strokes) —
 * it only compares `.length`.
 */
const largerAndSize = <T>(
  a: readonly T[],
  b: readonly T[]
): [readonly T[], readonly T[], number, number] =>
  a.length < b.length ? [b, a, b.length, a.length] : [a, b, a.length, b.length];

/**
 * Whole-to-whole distance: walk the shorter stroke, sampling the longer at a proportional index,
 * summing Manhattan distances, averaged over the shorter length. Handles differing point counts.
 */
export const wholeWholeDistance: DistanceMetric = (p1, p2) => {
  const [k1, k2, n, m] = largerAndSize(p1, p2);
  let dist = 0;
  for (let i = 0; i < m; i++) {
    const jOfI = Math.trunc(Math.trunc(n / m) * i);
    dist += manhattan(k1[jOfI], k2[i]);
  }
  return Math.trunc(dist / m);
};

// ── Correspondence map ────────────────────────────────────────────────────────

/** Greedy initial N-stroke map: assign each shorter-pattern stroke to its nearest free longer one. */
const initStrokeMap = (
  p1: Pattern,
  p2: Pattern,
  metric: DistanceMetric
): StrokeMap => {
  const [k1, k2, n, m] = largerAndSize(p1, p2);
  const map: StrokeMap = Array.from({ length: n }, () => -1);
  const free = Array.from({ length: n }, () => true);
  for (let i = 0; i < m; i++) {
    let minDist = Number.POSITIVE_INFINITY;
    let minJ = -1;
    for (let j = 0; j < n; j++) {
      if (free[j]) {
        const d = metric(k1[j], k2[i]);
        if (d < minDist) {
          minDist = d;
          minJ = j;
        }
      }
    }
    if (minJ !== -1) {
      free[minJ] = false;
      map[minJ] = i;
    }
  }
  return map;
};

/**
 * Refine the N-stroke map by iterative improvement (3 passes): for each assigned stroke, try swapping
 * or reassigning to reduce total distance. Mirrors the reference's L=3 hill-climb.
 */
export const getMap = (
  p1: Pattern,
  p2: Pattern,
  metric: DistanceMetric
): StrokeMap => {
  const [k1, k2] = largerAndSize(p1, p2);
  const map = initStrokeMap(p1, p2, metric);
  const L = 3;
  for (let l = 0; l < L; l++) {
    for (let i = 0; i < map.length; i++) {
      if (map[i] === -1) continue;
      let dii = metric(k1[i], k2[map[i]]);
      for (let j = 0; j < map.length; j++) {
        if (map[i] === -1) break; // map[i] may have been cleared within this inner loop
        if (map[j] !== -1) {
          const djj = metric(k1[j], k2[map[j]]);
          const dij = metric(k1[j], k2[map[i]]);
          const dji = metric(k1[i], k2[map[j]]);
          if (dji + dij < dii + djj) {
            const mapj = map[j];
            map[j] = map[i];
            map[i] = mapj;
            dii = dij;
          }
        } else {
          const dij = metric(k1[j], k2[map[i]]);
          if (dij < dii) {
            map[j] = map[i];
            map[i] = -1;
            dii = dij;
          }
        }
      }
    }
  }
  return map;
};

/**
 * `getMap` specialised for `endPointDistance`, reading precomputed endpoints.
 *
 * Identical algorithm to `getMap` — same greedy seed, same 3-pass hill-climb, same comparisons in
 * the same order — but every `metric(k1[x], k2[y])` becomes flat Float64Array arithmetic instead of
 * a call that re-walks stroke → point → coordinate. This is the coarse pass's inner loop, and it
 * dominates recognition (~840k metric evaluations for one worst-case character).
 *
 * The generic `getMap` stays for the fine pass, which uses a different metric that genuinely needs
 * whole strokes.
 */
export const getMapEndPoints = (
  a: EndPoints,
  aLength: number,
  b: EndPoints,
  bLength: number
): StrokeMap => {
  // Mirror largerAndSize: the map is indexed by the LONGER pattern's strokes.
  const swap = aLength < bLength;
  const k1 = swap ? b : a;
  const k2 = swap ? a : b;
  const n = swap ? bLength : aLength;
  const m = swap ? aLength : bLength;

  const map: StrokeMap = Array.from({ length: n }, () => -1);
  const free = Array.from({ length: n }, () => true);
  for (let i = 0; i < m; i++) {
    let minDist = Number.POSITIVE_INFINITY;
    let minJ = -1;
    for (let j = 0; j < n; j++) {
      if (free[j]) {
        const d = endPointDistanceAt(k1, j, k2, i);
        if (d < minDist) {
          minDist = d;
          minJ = j;
        }
      }
    }
    if (minJ !== -1) {
      free[minJ] = false;
      map[minJ] = i;
    }
  }

  for (let l = 0; l < 3; l++) {
    for (let i = 0; i < n; i++) {
      if (map[i] === -1) continue;
      let dii = endPointDistanceAt(k1, i, k2, map[i]);
      for (let j = 0; j < n; j++) {
        if (map[i] === -1) break; // map[i] may have been cleared within this inner loop
        if (map[j] !== -1) {
          const djj = endPointDistanceAt(k1, j, k2, map[j]);
          const dij = endPointDistanceAt(k1, j, k2, map[i]);
          const dji = endPointDistanceAt(k1, i, k2, map[j]);
          if (dji + dij < dii + djj) {
            const mapj = map[j];
            map[j] = map[i];
            map[i] = mapj;
            dii = dij;
          }
        } else {
          const dij = endPointDistanceAt(k1, j, k2, map[i]);
          if (dij < dii) {
            map[j] = map[i];
            map[i] = -1;
            dii = dij;
          }
        }
      }
    }
  }
  return map;
};

const concatStrokes = (pattern: Pattern, from: number, to: number): Stroke => {
  let out: ReadonlyArray<readonly [number, number]> = pattern[from];
  for (let t = from + 1; t <= to; t++) out = [...out, ...pattern[t]];
  return out;
};

/**
 * Complete a partial N-stroke map into an M–N map: assign every still-`-1` slot by extending
 * neighbours and, for runs of unassigned strokes between two assigned ones, choosing the split point
 * that minimizes the combined distance of the concatenated stroke groups.
 */
export const completeMap = (
  p1: Pattern,
  _p2: Pattern,
  metric: DistanceMetric,
  input: StrokeMap
): StrokeMap => {
  // k1 = larger pattern (map is indexed over it); k2 = smaller (map values index into it).
  const [k1, k2] = largerAndSize(p1, _p2);
  const map = [...input];
  if (!map.includes(-1)) return map;

  // Extend the last assigned value forward to the end.
  let lastUnassigned = map.length;
  let mapLastTo = -1;
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i] === -1) lastUnassigned = i;
    else {
      mapLastTo = map[i];
      break;
    }
  }
  for (let i = lastUnassigned; i < map.length; i++) map[i] = mapLastTo;

  // Extend the first assigned value backward to the start.
  let firstUnassigned = -1;
  let mapFirstTo = -1;
  for (let i = 0; i < map.length; i++) {
    if (map[i] === -1) firstUnassigned = i;
    else {
      mapFirstTo = map[i];
      break;
    }
  }
  for (let i = 0; i <= firstUnassigned; i++) map[i] = mapFirstTo;

  // For interior runs of -1, pick the split that best matches the two reference strokes.
  for (let i = 0; i < map.length; i++) {
    if (i + 1 < map.length && map[i + 1] === -1) {
      const start = i;
      let stop = i + 1;
      while (stop < map.length && map[stop] === -1) stop++;

      let div = start;
      let maxDist = Number.POSITIVE_INFINITY;
      for (let j = start; j < stop; j++) {
        // map values index the smaller pattern (k2); compare the two concatenated input-stroke
        // groups against the reference strokes they'd map to.
        const strokeAb = concatStrokes(k1, start, j);
        const strokeBc = concatStrokes(k1, j + 1, stop);
        const dAb = metric(strokeAb, k2[map[start]]);
        const dBc = metric(strokeBc, k2[map[stop]]);
        if (dAb + dBc < maxDist) {
          div = j;
          maxDist = dAb + dBc;
        }
      }
      for (let j = start; j <= div; j++) map[j] = map[start];
      for (let j = div + 1; j < stop; j++) map[j] = map[stop];
    }
  }
  return map;
};

export { concatStrokes, largerAndSize };
