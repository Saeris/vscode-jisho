/**
 * Reference stroke patterns for the handwriting recognizer, extracted from KanjiCanvas
 * (© 2019 Dominik Klein, MIT — http://github.com/asdfjkl/kanjicanvas) with moment normalization.
 * Data only; the recognition algorithm is our own functional reimplementation (see index.ts).
 *
 * The patterns are stored as a compact binary blob (base64 in patterns.data.ts, ~1.7MB vs the
 * ~8MB JS array literal they replaced) and decoded once here into `RefPattern[]`. Decoding a flat
 * ArrayBuffer is far cheaper — for both parse time and heap — than a giant nested array literal.
 *
 * Base64 rather than a fetched `.bin`, and it is worth knowing this is no longer about the CSP: a
 * `connect-src` is ours to grant. It stays inline because the alternative buys almost nothing. The
 * encoding costs 440KB raw (285KB compressed), which is 0.7% of a 39MB `.vsix`, and a fetch would
 * trade that for a network round trip on the chunk's critical path plus a CSP directive to audit.
 *
 * Binary layout (little-endian) — this file is the authoritative decoder:
 *   u32 entryCount; per entry: u16 charCode, u16 strokeCount, u16 actualStrokes,
 *     per stroke: u16 pointCount, (f32 x, f32 y) × pointCount.
 *
 * There is no encoder script in the tree (an earlier comment here claimed `scripts/encode-patterns.ts`,
 * which has never existed) — re-extracting from upstream KanjiCanvas is backlogged.
 */
import { patternsBase64 } from "./patterns.data";
import type { Point, RefPattern, Stroke } from "./types";

const decodePatterns = (b64: string): RefPattern[] => {
  // `fromBase64` decodes in one native step. The hand-rolled `atob` + charCodeAt copy it replaces
  // was 3.9ms of the 4.2ms this whole function costs — the decode dominated, and the walk below is
  // nearly free by comparison. Measured on the engine floor's Chromium 148: 10.7ms -> 2.8ms for the
  // full load, byte-identical across all 2,213 patterns.
  const dv = new DataView(Uint8Array.fromBase64(b64).buffer);
  let o = 0;
  const entryCount = dv.getUint32(o, true);
  o += 4;
  const patterns: RefPattern[] = [];
  for (let e = 0; e < entryCount; e++) {
    const char = String.fromCharCode(dv.getUint16(o, true));
    o += 2;
    const strokeCount = dv.getUint16(o, true);
    o += 2;
    const actualStrokes = dv.getUint16(o, true);
    o += 2;
    const strokes: Stroke[] = [];
    for (let s = 0; s < actualStrokes; s++) {
      const pointCount = dv.getUint16(o, true);
      o += 2;
      const points: Point[] = [];
      for (let p = 0; p < pointCount; p++) {
        const x = dv.getFloat32(o, true);
        o += 4;
        const y = dv.getFloat32(o, true);
        o += 4;
        points.push([x, y]);
      }
      strokes.push(points);
    }
    patterns.push([char, strokeCount, strokes]);
  }
  return patterns;
};

export const refPatterns: RefPattern[] = decodePatterns(patternsBase64);
