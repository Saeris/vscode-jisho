/**
 * Shared types for the handwriting recognizer — a clean-room functional reimplementation of the
 * KanjiCanvas algorithm (Dominik Klein, MIT — http://github.com/asdfjkl/kanjicanvas), itself an
 * implementation of Wakahara et al.'s stroke-order/number-free one-to-one stroke-correspondence
 * recognition. We reverse-engineered the algorithm from the reference implementation and rebuilt it
 * as pure, typed functions; behavioral fidelity is pinned by the ported reference tests.
 */

/** A single point: `[x, y]`. */
export type Point = readonly [number, number];

/** One stroke: an ordered list of points. */
export type Stroke = readonly Point[];

/** A pattern: an ordered list of strokes (a whole character). */
export type Pattern = readonly Stroke[];

/** A reference pattern entry: `[character, canonicalStrokeCount, strokes]`. */
export type RefPattern = readonly [string, number, Pattern];

/**
 * A stroke-correspondence map. `map[i] = j` means input/reference stroke `i` corresponds to the
 * other pattern's stroke `j`; `-1` means unassigned (before completion).
 */
export type StrokeMap = number[];

/** A distance metric between two strokes (endpoint / initial / whole-whole). */
export type DistanceMetric = (a: Stroke, b: Stroke) => number;
