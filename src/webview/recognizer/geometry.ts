/**
 * Preprocessing + feature extraction: moment normalization and interval resampling. Pure functions
 * reimplemented from the KanjiCanvas reference (see types.ts). All operate on immutable patterns and
 * return fresh arrays.
 */
import type { Pattern, Point, Stroke } from "./types";

/** Euclidean distance between two points. */
export const euclid = (a: Point, b: Point): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

// ── Image moments (over all points of a pattern) ──────────────────────────────
// m00 = point count, m10/m01 = sum of x/y, mu20/mu02 = variance about a centroid.
const m00 = (pattern: Pattern): number =>
  pattern.reduce((sum, stroke) => sum + stroke.length, 0);

const m10 = (pattern: Pattern): number =>
  pattern.reduce(
    (sum, stroke) => sum + stroke.reduce((s, p) => s + p[0], 0),
    0
  );

const m01 = (pattern: Pattern): number =>
  pattern.reduce(
    (sum, stroke) => sum + stroke.reduce((s, p) => s + p[1], 0),
    0
  );

const mu20 = (pattern: Pattern, xc: number): number =>
  pattern.reduce(
    (sum, stroke) =>
      sum + stroke.reduce((s, p) => s + (p[0] - xc) * (p[0] - xc), 0),
    0
  );

const mu02 = (pattern: Pattern, yc: number): number =>
  pattern.reduce(
    (sum, stroke) =>
      sum + stroke.reduce((s, p) => s + (p[1] - yc) * (p[1] - yc), 0),
    0
  );

/** Aspect-ratio adaptive normalization factor (Wakahara's ARAN): `sqrt(sin((π/2)·r))`. */
const aran = (width: number, height: number): number => {
  const r1 = height > width ? width / height : height / width;
  return Math.sqrt(Math.sin((Math.PI / 2) * r1));
};

/** Translate every point of a pattern by `(dx, dy)`. */
const transform = (pattern: Pattern, dx: number, dy: number): Pattern =>
  pattern.map((stroke) => stroke.map((p): Point => [p[0] + dx, p[1] + dy]));

/**
 * Moment-normalize a pattern into a 256×256 box: centre it on its centroid, scale by the moment
 * spread with the ARAN aspect correction, and translate into the target box. This is the input
 * preprocessing that makes recognition size/position invariant (matching the reference reference
 * patterns, which were extracted with the same normalization).
 */
export const momentNormalize = (pattern: Pattern): Pattern => {
  const newWidth = 256;
  const newHeight = 256;

  let xMin = 256;
  let xMax = 0;
  let yMin = 256;
  let yMax = 0;
  for (const stroke of pattern) {
    for (const [x, y] of stroke) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const oldWidth = Math.abs(xMax - xMin);
  const oldHeight = Math.abs(yMax - yMin);

  const r2 = aran(oldWidth, oldHeight);
  let aranWidth = newWidth;
  let aranHeight = newHeight;
  if (oldHeight > oldWidth) aranWidth = r2 * newWidth;
  else aranHeight = r2 * newHeight;

  const xOffset = (newWidth - aranWidth) / 2;
  const yOffset = (newHeight - aranHeight) / 2;

  const total = m00(pattern);
  const xc = m10(pattern) / total;
  const yc = m01(pattern) / total;
  const xcHalf = aranWidth / 2;
  const ycHalf = aranHeight / 2;

  // `|| 0` mirrors the reference: a zero moment (e.g. a single-point stroke) yields no scaling.
  const alpha = aranWidth / (4 * Math.sqrt(mu20(pattern, xc) / total)) || 0;
  const beta = aranHeight / (4 * Math.sqrt(mu02(pattern, yc) / total)) || 0;

  const normalized: Pattern = pattern.map((stroke) =>
    stroke.map(
      (p): Point => [alpha * (p[0] - xc) + xcHalf, beta * (p[1] - yc) + ycHalf]
    )
  );
  return transform(normalized, xOffset, yOffset);
};

/**
 * Resample each stroke to points spaced ~`interval` apart along its arc length. Always keeps the
 * first point; keeps the last when the trailing segment is long enough (or the stroke has a single
 * kept point). This yields a stroke-length-normalized point sequence for the distance metrics.
 */
export const extractFeatures = (pattern: Pattern, interval: number): Pattern =>
  pattern.map((stroke): Stroke => {
    const extracted: Point[] = [];
    let dist = 0;
    for (let j = 0; j < stroke.length; j++) {
      if (j === 0) extracted.push(stroke[0]);
      if (j > 0) dist += euclid(stroke[j - 1], stroke[j]);
      if (dist >= interval && j > 1) {
        dist -= interval;
        extracted.push(stroke[j]);
      }
    }
    if (extracted.length === 1) {
      extracted.push(stroke[stroke.length - 1]);
    } else if (dist > 0.75 * interval) {
      extracted.push(stroke[stroke.length - 1]);
    }
    return extracted;
  });
