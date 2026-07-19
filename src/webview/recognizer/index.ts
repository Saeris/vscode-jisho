/**
 * Handwriting recognizer — public entry. A clean-room functional reimplementation of the KanjiCanvas
 * algorithm (Dominik Klein, MIT — http://github.com/asdfjkl/kanjicanvas; Wakahara et al.'s one-to-one
 * stroke-correspondence method). Reverse-engineered from the reference implementation and rebuilt as
 * pure typed functions; behavioral fidelity is pinned by the ported reference tests.
 *
 * Pipeline: moment-normalize the input → resample to feature points → coarse classification over all
 * reference patterns (fast endpoint distance) → fine classification of the top candidates
 * (initial-map + whole-whole weighted distance) → ranked candidate characters.
 */
import {
  completeMap,
  concatStrokes,
  endPointDistance,
  endPointsOf,
  getMap,
  getMapEndPoints,
  initialDistance,
  wholeWholeDistance
} from "./correspondence";
import { extractFeatures, momentNormalize } from "./geometry";
import type { DistanceMetric, Pattern, RefPattern, StrokeMap } from "./types";
import type { EndPoints } from "./correspondence";

/** Only compare patterns whose stroke counts are within the reference's ±2 window. */
const strokeCountCompatible = (
  inputLength: number,
  refLength: number
): boolean => inputLength < refLength + 2 && inputLength > refLength - 3;

/**
 * Endpoints for a reference set, computed once and reused.
 *
 * The reference patterns are immutable and shared across every recognition, so deriving their
 * endpoints per call would repeat identical work on each stroke the user draws. Keyed by the array
 * identity (a WeakMap, so a caller passing a different set — the tests do — gets its own entry and
 * nothing leaks).
 */
const endPointCache = new WeakMap<object, EndPoints[]>();

const referenceEndPoints = (
  refPatterns: readonly RefPattern[]
): EndPoints[] => {
  const cached = endPointCache.get(refPatterns);
  if (cached) return cached;
  const computed = refPatterns.map((p) => endPointsOf(p[2]));
  endPointCache.set(refPatterns, computed);
  return computed;
};

/**
 * Overall distance between two patterns given an M–N map: for each reference stroke, concatenate the
 * input strokes mapped to it and sum the metric distance.
 */
const computeDistance = (
  p1: Pattern,
  p2: Pattern,
  metric: DistanceMetric,
  map: StrokeMap
): number => {
  const [k1, k2] = p1.length >= p2.length ? [p1, p2] : [p2, p1];
  let dist = 0;
  let idx = 0;
  while (idx < k1.length) {
    const strokeIdx = k2[map[idx]];
    const start = idx;
    let stop = start + 1;
    while (stop < map.length && map[stop] === map[idx]) stop++;
    const strokeConcat = concatStrokes(k1, start, stop - 1);
    dist += metric(strokeIdx, strokeConcat);
    idx = stop;
  }
  return dist;
};

/**
 * Weighted whole-whole distance: like computeDistance with wholeWholeDistance, but concatenated
 * (many-to-one) strokes are penalized by their length ratio so a good split isn't over-rewarded.
 */
const computeWholeDistanceWeighted = (
  p1: Pattern,
  p2: Pattern,
  map: StrokeMap
): number => {
  const [k1, k2] = p1.length >= p2.length ? [p1, p2] : [p2, p1];
  let dist = 0;
  let idx = 0;
  while (idx < k1.length) {
    const strokeIdx = k2[map[idx]];
    const start = idx;
    let stop = start + 1;
    while (stop < map.length && map[stop] === map[idx]) stop++;
    const strokeConcat = concatStrokes(k1, start, stop - 1);
    let distIdx = wholeWholeDistance(strokeIdx, strokeConcat);
    if (stop > start + 1) {
      let mm = strokeIdx.length;
      let nn = strokeConcat.length;
      if (nn < mm) [nn, mm] = [mm, nn];
      distIdx = distIdx * (nn / mm);
    }
    dist += distIdx;
    idx = stop;
  }
  return dist;
};

interface Scored {
  index: number;
  dist: number;
}

/** Coarse pass: rank all stroke-count-compatible references by endpoint-distance map cost. */
const coarseClassification = (
  input: Pattern,
  refPatterns: readonly RefPattern[]
): Scored[] => {
  const inputLength = input.length;
  const candidates: Scored[] = [];
  // Hoisted out of the loop: the input's endpoints are the same for every candidate, and this pass
  // compares against hundreds of them.
  const inputEnds = endPointsOf(input);
  const refEnds = referenceEndPoints(refPatterns);
  for (let i = 0; i < refPatterns.length; i++) {
    const refLength = refPatterns[i][1];
    if (!strokeCountCompatible(inputLength, refLength)) continue;
    const refPattern = refPatterns[i][2];
    let map = getMapEndPoints(
      refEnds[i],
      refPattern.length,
      inputEnds,
      inputLength
    );
    map = completeMap(refPattern, input, endPointDistance, map);
    const dist = computeDistance(refPattern, input, endPointDistance, map);
    let m = refLength;
    let n = refPattern.length;
    if (n < m) [n, m] = [m, n];
    candidates.push({ index: i, dist: dist * (m / n) });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates;
};

/**
 * How many coarse candidates the fine pass re-ranks. Inherited from the KanjiCanvas reference.
 *
 * Do NOT lower this to save time. Measured against the corpus (315 characters), dropping it to 25
 * left the top-1 answer intact in 272 of 274 changed cases — but changed the CANDIDATE LIST for
 * 87% of inputs, and the handwriting panel shows eight chips that a user picks from. The coarse
 * ranking is a crude endpoint metric; the fine pass genuinely reorders far down the list, so the
 * "wasted" evaluations are what makes chips 2-8 trustworthy. A ~1.2x speedup is not worth
 * degrading the visible result set.
 */
const FINE_CANDIDATES = 100;

/** Fine pass: re-rank the top coarse candidates with the initial-map + weighted whole-whole metric. */
const fineClassification = (
  input: Pattern,
  coarse: Scored[],
  refPatterns: readonly RefPattern[]
): Scored[] => {
  const inputLength = input.length;
  const candidates: Scored[] = [];
  for (let i = 0; i < Math.min(coarse.length, FINE_CANDIDATES); i++) {
    const j = coarse[i].index;
    const refLength = refPatterns[j][1];
    const refPattern = refPatterns[j][2];
    if (!strokeCountCompatible(inputLength, refLength)) continue;
    let map = getMap(refPattern, input, initialDistance);
    map = completeMap(refPattern, input, wholeWholeDistance, map);
    let dist = computeWholeDistanceWeighted(refPattern, input, map);
    const m = Math.min(inputLength, refPattern.length);
    dist = dist / m;
    candidates.push({ index: j, dist });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates;
};

/** True when a pattern spans no area — every point collapses to one location (a dot or a tap). */
const isDegenerate = (pattern: Pattern): boolean => {
  let x0: number | undefined;
  let y0: number | undefined;
  for (const stroke of pattern) {
    for (const [x, y] of stroke) {
      x0 ??= x;
      y0 ??= y;
      if (x !== x0 || y !== y0) return false;
    }
  }
  return true;
};

/**
 * Recognize a handwritten pattern. Returns the top candidate characters, best first. `strokes` is
 * the raw captured input (`Array<Array<[x, y]>>`); it is normalized internally, so it need not be
 * pre-scaled.
 *
 * Degenerate input is rejected up front: strokes with fewer than two points (stray dots/taps) are
 * dropped, and a pattern with no spatial extent returns no candidates rather than crashing — moment
 * normalization of a zero-area pattern yields NaN coordinates, which the distance metrics can't rank.
 */
export const recognize = (
  strokes: Pattern,
  refPatterns: readonly RefPattern[],
  limit = 10
): string[] => {
  const usable = strokes.filter((stroke) => stroke.length >= 2);
  if (usable.length === 0 || isDegenerate(usable)) return [];
  const normalized = momentNormalize(usable);
  const features = extractFeatures(normalized, 20);
  const coarse = coarseClassification(features, refPatterns);
  const fine = fineClassification(features, coarse, refPatterns);
  return fine.slice(0, limit).map((c) => refPatterns[c.index][0]);
};

export type { Pattern, Point, RefPattern, Stroke } from "./types";
