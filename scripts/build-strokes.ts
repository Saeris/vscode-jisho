/**
 * Stroke-SVG transform: regenerate `assets/kanji-svgs/` from the AnimCJK source (pinned SHA).
 *
 * Run occasionally, not per-build:  vp run build:strokes
 *
 * Strips the embedded <style> (the app owns all styling), groups the markup into
 * glyph/strokes/guides, drops the baked-in per-stroke delays, and regenerates the direction guides
 * from each stroke's median. Format, rationale, and lessons: docs/STROKE-ORDER.md.
 *
 * Licensing: the paths derive from the Arphic PL KaitiM fonts via AnimCJK and stay under the Arphic
 * Public License (ARPHICPL.TXT ships alongside the output).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchAcjkMap,
  KANA_SOURCE_BASE,
  parseAcjk,
  SOURCE_BASE,
  type AcjkPart
} from "./acjk.ts";
import { KANA_CHART, toKatakana } from "../src/shared/kana-chart.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "assets", "kanji-svgs");
/**
 * Kana get their own directory because they carry a DIFFERENT LICENCE: AnimCJK's `svgsJaKana` is
 * LGPL, while the kanji derive from the Arphic PL KaitiM fonts. Two licences in one folder means one
 * LICENCE file that is wrong for half its contents, so they are kept physically apart and each
 * directory ships the terms that actually govern it.
 */
const KANA_OUT_DIR = join(root, "assets", "kana-svgs");

/**
 * The offset distance the guide path is pushed away from its stroke, in viewBox units (0-1024).
 * `delta` in the original algorithm.
 */
const DELTA = 96;
/** Points closer together than this are collapsed when simplifying a median. */
const REDUCE_THRESHOLD = 42;

interface Point {
  x: number;
  y: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

const distance = (a: Point, b: Point): number =>
  Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Every vertex of a median path.
 *
 * The two upstream sets write the same polyline two different ways, and both have to parse:
 *
 *   kanji  `M677 114L731 160L541 243`            explicit L before every vertex
 *   kana   `M 570,440 610,484 460,727 200,836`   one M, then IMPLICIT lineto pairs
 *
 * Matching on the command letter (the original `[ML]` pattern) finds exactly ONE point in a kana
 * median, and one point has no direction — which is why every kana shipped with a start numeral but
 * no direction arrows until this was found. Reading the coordinate PAIRS instead covers both:
 * medians are polylines by construction, so every number in one is a vertex ordinate.
 *
 * Ordinates may be DECIMAL (`M 111.6,323.2 174,363.7`), which kanji medians never are. An
 * integer-only pattern does not simply skip those points — it matches fragments ACROSS them,
 * reading `111.6,323.2` as the point `6,323` and then pairing the leftover `.2` with the next
 * number. お's first stroke became a guide that doubled back on itself at x≈2, drawn as a vertical
 * bar over the edge of the canvas.
 */
const medianPoints = (d: string): Point[] =>
  [...d.matchAll(/(-?\d*\.?\d+)[ ,](-?\d*\.?\d+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2])
  }));

/**
 * Drop vertices bunched up at either end of the median. Those clusters are the stroke's entry/exit
 * flicks; keeping them makes the guide wobble at exactly the point the reader is looking.
 */
const reducePointsNum = (input: Point[]): Point[] => {
  const points = input.map((p) => ({ ...p }));
  const t = REDUCE_THRESHOLD;
  if (points.length < 3) return points;
  const first = { ...points[0] };
  const last = { ...points[points.length - 1] };

  while (
    points.length > 2 &&
    distance(first, points[1]) < t &&
    distance(points[0], last) > 2 * t
  ) {
    points[1].x = Math.round((points[0].x + points[1].x) / 2);
    points[1].y = Math.round((points[0].y + points[1].y) / 2);
    points.shift();
  }
  if (points.length < 3) return points;
  while (
    points.length > 2 &&
    distance(last, points[points.length - 2]) < t &&
    distance(first, points[points.length - 1]) > 2 * t
  ) {
    const n = points.length;
    points[n - 2].x = Math.round((points[n - 2].x + points[n - 1].x) / 2);
    points[n - 2].y = Math.round((points[n - 2].y + points[n - 1].y) / 2);
    points.pop();
  }
  return points;
};

interface Bounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

const boundsOf = (points: Point[]): Bounds =>
  points.reduce<Bounds>(
    (b, p) => ({
      xMin: Math.min(b.xMin, p.x),
      yMin: Math.min(b.yMin, p.y),
      xMax: Math.max(b.xMax, p.x),
      yMax: Math.max(b.yMax, p.y)
    }),
    {
      xMin: points[0].x,
      yMin: points[0].y,
      xMax: points[0].x,
      yMax: points[0].y
    }
  );

/**
 * Taper the guide toward its start: later points are pulled back by up to (rx, ry), so the guide
 * converges on the stroke rather than running parallel to its whole length. `rxt`/`ryt` restrict the
 * pull to points on one side of the start.
 */
const reducePointsSize = (
  input: Point[],
  rx: number,
  ry: number,
  rxt: string,
  ryt: string,
  b: Bounds
): Point[] => {
  const points = input.map((p) => ({ ...p }));
  const dx = b.xMax - b.xMin;
  const dy = b.yMax - b.yMin;
  const rxc = Math.min(rx, dx / 2);
  const ryc = Math.min(ry, dy / 2);

  for (let k = 1; k < points.length; k++) {
    if (rxc && dx) {
      if (rxt === "R" && points[k].x > points[0].x)
        points[k].x -= (rxc * (points[k].x - b.xMin)) / dx;
      else if (rxt === "L" && points[k].x < points[0].x)
        points[k].x -= (rxc * (points[k].x - b.xMax)) / dx;
      else if (rxt === "" && points[k].x !== points[0].x)
        points[k].x -= (rxc * (points[k].x - points[0].x)) / dx;
    }
    if (ryc && dy) {
      if (ryt === "B" && points[k].y > points[0].y)
        points[k].y -= (ryc * (points[k].y - b.yMin)) / dy;
      else if (ryt === "T" && points[k].y < points[0].y)
        points[k].y -= (ryc * (points[k].y - b.yMax)) / dy;
      else if (ryt === "" && points[k].y !== points[0].y)
        points[k].y -= (ryc * (points[k].y - points[0].y)) / dy;
    }
  }
  return points;
};

/** A quadratic-smoothed path through the points — the guide's drawn shape. */
const smoothPath = (points: Point[]): string => {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${round(points[0].x)},${round(points[0].y)}`;
  const q = n > 4 ? 2 : n > 3 ? 4 : 8;
  let path = `M${round(points[0].x)},${round(points[0].y)}`;
  for (let k = 1; k < n - 1; k++) {
    const xc = points[k].x + (points[k + 1].x - points[k].x) / q;
    const yc = points[k].y + (points[k + 1].y - points[k].y) / q;
    path += ` Q${round(points[k].x)},${round(points[k].y)} ${round(xc)},${round(yc)}`;
  }
  if (n > 2) {
    const xc = points[n - 1].x - (points[n - 1].x - points[n - 2].x) / q;
    const yc = points[n - 1].y - (points[n - 1].y - points[n - 2].y) / q;
    path += ` Q${round(xc)},${round(yc)} ${round(points[n - 1].x)},${round(points[n - 1].y)}`;
  } else {
    path += ` L${round(points[1].x)},${round(points[1].y)}`;
  }
  return path;
};

/** Heading of a segment, classified as Horizontal / Vertical / Oblique + direction. */
type Slope = [axis: "H" | "V" | "O", lr: "L" | "R", tb: "T" | "B"];

const slopeOf = (from: Point, to: Point): Slope => {
  // Deliberately preserves the original's rounded constant (57, not 57.29…): the offset table was
  // tuned against these exact skewed angles, so "fixing" the maths would silently change every
  // guide. Details: docs/STROKE-ORDER.md.
  const angle =
    Math.round(360 / (2 * Math.PI)) * Math.atan2(to.y - from.y, to.x - from.x);
  const abs = Math.abs(angle);
  const axis = abs < 30 || abs > 150 ? "H" : abs > 60 && abs < 120 ? "V" : "O";
  return [axis, to.x > from.x ? "R" : "L", to.y > from.y ? "B" : "T"];
};

interface Offset {
  a0: number;
  b0: number;
  reducX: number;
  reducY: number;
  reducXT: string;
  reducYT: string;
}

const NO_OFFSET: Offset = {
  a0: 0,
  b0: 0,
  reducX: 0,
  reducY: 0,
  reducXT: "",
  reducYT: ""
};

/**
 * Pick the guide's offset from the stroke's start and end headings, so the guide sits clear of the
 * stroke it describes. Hand-tuned table ported from guide-to-japanese's `addGuidelines.ts` —
 * restructured but not retuned (docs/STROKE-ORDER.md).
 */
const offsetFor = (
  s0: Slope,
  sM: Slope,
  points: Point[],
  b: Bounds
): Offset => {
  const n = points.length;
  const [x0, y0] = [points[0].x, points[0].y];
  const [xm0, ym0] = [points[n - 1].x, points[n - 1].y];
  const o = (p: Partial<Offset>): Offset => ({ ...NO_OFFSET, ...p });

  if (s0[0] === "H" && sM[0] === "H") {
    if (s0[1] === "R" && sM[1] === "R") {
      return n > 4 && Math.abs(ym0 - y0) > 2 * DELTA
        ? o({
            a0: DELTA * 1.125 * 0.714,
            b0: -DELTA * 0.714,
            reducX: DELTA * 1.125 * 0.714
          })
        : o({ b0: DELTA });
    }
    if (s0[1] === "R" && sM[1] === "L") {
      return xm0 < x0
        ? o({ a0: -DELTA, b0: DELTA, reducX: DELTA, reducY: 2 * DELTA })
        : o({
            b0: DELTA,
            reducX: xm0 < b.xMax ? DELTA * 0.5 + b.xMax - xm0 : DELTA
          });
    }
    return o({ b0: DELTA });
  }
  if (s0[0] === "H" && sM[0] === "V") {
    if (s0[1] === "R" && sM[1] === "L" && b.yMin < y0)
      return o({
        b0: DELTA,
        reducX: DELTA * 1.25,
        reducY: DELTA,
        reducYT: "B"
      });
    if (s0[1] === "R" && sM[1] === "L" && b.xMax - b.xMin < DELTA)
      return o({ a0: -DELTA });
    return o({ b0: DELTA, reducX: DELTA * 1.25, reducY: DELTA * 2 });
  }
  if (s0[0] === "H" && sM[0] === "O") {
    if (s0[1] === "R" && sM[1] === "L") {
      const reducX =
        xm0 < x0
          ? 2 * DELTA
          : xm0 < b.xMax && b.yMax - b.yMin < (b.xMax - b.xMin) / 2
            ? DELTA * 0.5 + (b.xMax - xm0)
            : DELTA;
      let reducY = 0;
      let reducYT = "";
      if (xm0 < x0) reducY = 2 * DELTA;
      else if (ym0 < b.yMax && b.yMax - b.yMin > (b.xMax - b.xMin) / 2) {
        reducY = DELTA * 1.5 + (b.yMax - ym0);
        reducYT = "B";
      }
      return o({
        a0: xm0 < x0 ? -DELTA : 0,
        b0: DELTA,
        reducX,
        reducY,
        reducYT
      });
    }
    if (s0[1] === "R" && sM[1] === "R") {
      return sM[2] === "T"
        ? o({ b0: -DELTA })
        : o({ a0: DELTA * 1.25 * 0.714, b0: -DELTA * 0.714 });
    }
    return o({ a0: DELTA * 1.25 });
  }
  if (s0[0] === "V" && sM[0] === "V") {
    return s0[1] === "R" && sM[1] === "L" && s0[2] === "B" && sM[2] === "T"
      ? o({
          a0: DELTA * 1.25 * 0.714,
          b0: -DELTA * 0.714,
          reducX: DELTA * (1.25 * 0.714 + 1),
          reducY: DELTA * (1 - 0.714)
        })
      : o({ a0: DELTA * 1.25 });
  }
  if (s0[0] === "V" && sM[0] === "H") {
    if (s0[2] === "B" && sM[1] === "R")
      return o({ a0: DELTA * 1.25, reducX: DELTA * 1.25, reducY: DELTA });
    if (s0[2] === "B" && sM[1] === "L")
      return o({ a0: -DELTA, reducX: DELTA * 1.25, reducY: DELTA });
    return NO_OFFSET;
  }
  if (s0[0] === "V" && sM[0] === "O") {
    return s0[1] === "R" && sM[1] === "R"
      ? o({ a0: DELTA * 1.25, reducX: DELTA * 1.25, reducY: DELTA })
      : o({ a0: -DELTA, reducX: DELTA * 1.25, reducY: DELTA });
  }
  if (s0[0] === "O" && sM[0] === "O") {
    if (s0[1] === "R" && sM[1] === "R") {
      return s0[2] === "B" && sM[2] === "T"
        ? o({
            a0: DELTA * 1.25 * 0.714,
            b0: -DELTA * 0.714,
            reducY: DELTA * (1 - 0.714 + 0.5)
          })
        : o({ a0: DELTA * 1.25 * 0.714, b0: -DELTA * 0.714 });
    }
    if (s0[1] === "L" && sM[1] === "L")
      return o({ a0: DELTA * 1.25 * 0.714, b0: DELTA * 0.714 });
    if (s0[1] === "R" && sM[1] === "L") {
      if (s0[2] === "T" && sM[2] === "T")
        return o({
          a0: -DELTA * 1.25 * 0.714,
          b0: DELTA * 0.714,
          reducY: DELTA * (0.714 + 1),
          reducYT: "B"
        });
      if (s0[2] === "B" && sM[2] === "T" && xm0 > x0) {
        const wide = b.xMax - b.xMin > b.yMax - b.yMin;
        return o({
          a0: -DELTA * 0.714,
          b0: DELTA * 0.714,
          reducX: wide ? -DELTA * (0.714 * 2) - 2 * (b.xMax - xm0) : 0,
          reducY: wide ? 0 : DELTA * (0.714 * 2) + (b.yMax - ym0)
        });
      }
      return o({ a0: -DELTA, reducX: DELTA, reducY: DELTA });
    }
    return o({ a0: DELTA * 1.25 });
  }
  if (s0[0] === "O" && sM[0] === "H") {
    if (s0[1] === "R" && sM[1] === "R")
      return o({
        a0: DELTA * 1.25 * 0.714,
        b0: -DELTA * 0.714,
        reducX: DELTA * 1.25 * 0.714,
        reducY: DELTA * (1 - 0.714)
      });
    if (s0[1] === "L" && sM[1] === "L")
      return o({ a0: DELTA * 1.25 * 0.714, b0: DELTA * 0.714 });
    if (s0[1] === "R" && sM[1] === "L")
      return o({ a0: -DELTA, reducX: DELTA, reducY: DELTA });
    return o({ a0: DELTA * 1.25, reducY: DELTA });
  }
  if (s0[0] === "O" && sM[0] === "V") {
    if (s0[1] === "R" && sM[1] === "L") {
      return s0[2] === "B" && sM[2] === "T"
        ? o({ a0: DELTA * 0.714, b0: -DELTA * 0.714, reducX: DELTA * 1.714 })
        : o({ a0: -DELTA });
    }
    if (s0[1] === "R" && sM[1] === "R") {
      if (s0[2] === "B" && sM[2] === "T") {
        return ym0 < y0
          ? o({ a0: -DELTA * 0.714, b0: -DELTA * 0.714, reducY: DELTA * 0.714 })
          : o({ a0: DELTA * 0.714, b0: -DELTA * 0.714, reducX: DELTA * 1.714 });
      }
      return o({ a0: DELTA * 1.25 * 0.714, b0: -DELTA * 0.714 });
    }
    return o({ a0: DELTA * 1.25 });
  }
  return n > 5 ? o({ a0: -DELTA * 1.25, b0: DELTA }) : NO_OFFSET;
};

/**
 * One stroke's guides: a circled-numeral start marker (①…㉙ — the set's max is 29 strokes) plus
 * BOTH arrow variants — `aligned` traces the median, `offset` sits clear of it — so the app can
 * cross-fade between the two styles at runtime via --guide-offset.
 */
const guideFor = (d: string, index: number): string => {
  const raw = medianPoints(d);
  if (raw.length === 0) return "";
  const n = index + 1;
  const start = raw[0];
  // ①..⑳ are U+2460..U+2473; ㉑..㉟ continue at U+3251. Two blocks, one sequence.
  const numeral =
    n <= 20
      ? String.fromCodePoint(0x245f + n)
      : String.fromCodePoint(0x3250 + (n - 20));
  // --gs carries the stroke number, so CSS can compare it to the playhead directly. Emitting it
  // beats deriving it from sibling-index(): a guide is 1 element for a dot-only stroke and 3
  // otherwise, so any position-based arithmetic silently breaks on the former.
  const marker = `<text class="g${n}" style="--gs:${n}" x="${round(start.x)}" y="${round(start.y)}">${numeral}</text>`;

  if (raw.length < 2) return marker;

  const points = reducePointsNum(raw);
  if (points.length < 2) return marker;

  const aligned = smoothPath(points);
  const b = boundsOf(points);
  const s0 = slopeOf(points[0], points[1]);
  const sM = slopeOf(points[points.length - 2], points[points.length - 1]);
  const { a0, b0, reducX, reducY, reducXT, reducYT } = offsetFor(
    s0,
    sM,
    points,
    b
  );
  const shifted = reducePointsSize(
    points,
    reducX,
    reducY,
    reducXT,
    reducYT,
    b
  ).map((p) => ({
    x: p.x + a0,
    y: p.y + b0
  }));

  // Arrows BEFORE the numeral: SVG paints in document order, so emitting the marker first let each
  // arrow cross out its own start number — the numeral is the thing you read to know where to
  // begin, so it has to win.
  return (
    `<path class="g${n} aligned" style="--gs:${n}" d="${aligned}"/>` +
    `<path class="g${n} offset" style="--gs:${n}" d="${smoothPath(shifted)}"/>` +
    marker
  );
};

/** Extract every `<path …/>` whose attributes match `filter`, returning the raw tags. */
const pathsMatching = (
  svg: string,
  filter: (attrs: string) => boolean
): string[] =>
  [...svg.matchAll(/<path\s([^>]*?)\/?>/g)]
    .filter((m) => filter(m[1]))
    .map((m) => `<path ${m[1].trim()}/>`);

/** The `d` attribute of a path tag. */
const dOf = (tag: string): string => /\sd="([^"]*)"/.exec(tag)?.[1] ?? "";

/**
 * The arrowhead the guide paths point with. Lives in <defs> and is referenced by `marker-end`;
 * `orient="auto-start-reverse"` turns it to follow whichever direction its path runs.
 */
const ARROW_MARKER =
  `<marker id="guide-arrow" viewBox="0 0 16 16" refX="5" refY="5" markerWidth="4" markerHeight="4" ` +
  `orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="inherit"/></marker>`;

/** Padding around a part's median bounds, in viewBox units — covers stroke width plus a hit margin. */
const PART_PAD = 72;

/**
 * Invisible hit rectangles, one per part, sized to the part's stroke medians. Emitted largest-first
 * so an enclosing part (kamae like 囗) paints under the parts it encloses and the inner part wins
 * hit-testing.
 */
const partRects = (parts: AcjkPart[], strokeDs: string[]): string =>
  parts
    .map((p, idx) => {
      const points = p.ranges.flatMap((r) =>
        strokeDs.slice(r.start - 1, r.end).flatMap((d) => medianPoints(d))
      );
      const b = boundsOf(points);
      const x = Math.max(0, b.xMin - PART_PAD);
      const y = Math.max(0, b.yMin - PART_PAD);
      const w = Math.min(1024, b.xMax + PART_PAD) - x;
      const h = Math.min(1024, b.yMax + PART_PAD) - y;
      const label = `Part ${p.literal}${p.radical ? " (radical)" : ""}`;
      return {
        area: w * h,
        tag:
          `<rect data-part="${idx + 1}" data-literal="${p.literal}"` +
          `${p.radical ? ` data-radical="true"` : ""} role="button" tabindex="0" ` +
          `aria-label="${label}" x="${x}" y="${y}" width="${w}" height="${h}"/>`
      };
    })
    .sort((a, b) => b.area - a.area)
    .map((r) => r.tag)
    .join("");

/**
 * Rewrite one AnimCJK source SVG into our glyph/defs/strokes/guides shape, no <style> — the format
 * the player and chart render from (spec: docs/STROKE-ORDER.md). g.strokes must contain the medians
 * and nothing else, so sibling-index() is the stroke number.
 */
export const transform = (
  source: string,
  literal: string,
  parts: AcjkPart[] | null = null,
  /**
   * Which upstream set this came from. Kana are LGPL and live in `assets/kana-svgs`; kanji are
   * Arphic PL and live in `assets/kanji-svgs`. The header has to state the right one — a file that
   * misreports its own licence is worse than one that carries none.
   */
  kind: "kanji" | "kana" = "kanji"
): string => {
  const viewBox = /viewBox="([^"]*)"/.exec(source)?.[1] ?? "0 0 1024 1024";
  const id = /<svg id="([^"]*)"/.exec(source)?.[1] ?? "";

  // The filled glyph shapes carry an id; the animated medians carry a clip-path.
  const glyph = pathsMatching(
    source,
    (a) => a.includes("id=") && !a.includes("clip-path")
  );
  const allStrokes = pathsMatching(source, (a) => a.includes("clip-path"));
  const defs = /<defs>([\s\S]*?)<\/defs>/.exec(source)?.[1] ?? "";

  if (allStrokes.length === 0) {
    throw new Error(`No animated strokes found for ${literal}`);
  }

  /**
   * Group split-stroke FRAGMENTS: several paths that together draw ONE stroke.
   *
   * The kana set renders a stroke that crosses itself as two clipped pieces suffixed a/b on a
   * shared number — あ's third stroke is `c3a` + `c3b`. This is a CLIPPING workaround, not two
   * strokes: measured, both fragments carry the same `--d:3s` (so upstream animates them together)
   * and their medians are identical from the crossing onward, differing only in the first three
   * points, which are displaced ~740 units in x. Each fragment paints one half of a shape a single
   * swept median would leak outside of. Kanji never do this — 7 of 28 sampled kana do (あ お す な
   * ぬ の ば).
   *
   * So BOTH paths must render — dropping one leaves the stroke visibly unfinished — while counting,
   * numbering and guiding treat the group as one. The first fragment is the representative: it is
   * the one whose median starts where the pen actually lands (the trailing fragment's lead-in sits
   * off-canvas at x = -170, which is exactly why it must not drive the start marker).
   */
  const strokeNumber = (path: string, index: number): string =>
    /clip-path="url\(#\w*?c(\d+)[a-z]?\)"/.exec(path)?.[1] ?? String(index);
  const groups: string[][] = [];
  const groupIndex = new Map<string, number>();
  allStrokes.forEach((path, i) => {
    const n = strokeNumber(path, i);
    const at = groupIndex.get(n);
    if (at === undefined) {
      groupIndex.set(n, groups.length);
      groups.push([path]);
    } else {
      groups[at].push(path);
    }
  });

  // Drop the per-stroke --d delay: the stamped --stroke ordinal drives the timeline now, and the
  // app's CSS owns the timing. Keep pathLength (it normalises every stroke to 3333, so no JS
  // measurement is needed).
  const clean = (s: string): string =>
    s.replace(/\s*style="[^"]*"/, "").replace(/\s+/g, " ");
  const cleanGroups = groups.map((g) => g.map(clean));
  /** One representative path per stroke — what stroke COUNT and part mapping are computed from. */
  const cleanStrokes = cleanGroups.map((g) => g[0]);
  const guides = cleanStrokes.map((s, i) => guideFor(dOf(s), i)).join("");

  // Parts are only stamped when the acjk decomposition exactly covers the strokes AND the glyph
  // fills pair 1:1 with the medians — anything else means the datasets disagree, and stamping the
  // wrong strokes is worse than not offering the feature for that character.
  const usable =
    parts !== null &&
    parts.reduce(
      (n, p) => n + p.ranges.reduce((m, r) => m + (r.end - r.start + 1), 0),
      0
    ) === cleanStrokes.length &&
    glyph.length === cleanStrokes.length
      ? parts
      : null;
  const partOf = (stroke: number): number =>
    usable === null
      ? 0
      : usable.findIndex((p) =>
          p.ranges.some((r) => stroke >= r.start && stroke <= r.end)
        ) + 1;
  const stamp = (tag: string, stroke: number): string => {
    const part = partOf(stroke);
    return part === 0
      ? tag
      : tag.replace("<path ", `<path style="--part:${part}" `);
  };
  /**
   * Every median carries its stroke ORDINAL explicitly, rather than the CSS deriving one from
   * `sibling-index()`.
   *
   * The index was the ordinal only while paths and strokes were 1:1. A split stroke breaks that —
   * あ's third stroke is two siblings, so the second would draw a beat late and the character would
   * animate as four. Stamping the number lets both fragments claim stroke 3 and keeps the timeline
   * honest; for the 3,821 kanji, where no stroke is split, the stamped value equals the sibling
   * index it replaces.
   */
  const stampedStrokes = cleanGroups.flatMap((group, i) =>
    group.map((s) => {
      const withPart = stamp(s, i + 1);
      const style = `--stroke:${i + 1}`;
      return withPart.includes('style="')
        ? withPart.replace('style="', `style="${style};`)
        : withPart.replace("<path ", `<path style="${style}" `);
    })
  );
  const stampedGlyph = glyph.map((g, i) => stamp(g, i + 1));
  const rects =
    usable === null
      ? ""
      : partRects(
          usable,
          cleanStrokes.map((s) => dOf(s))
        );

  return [
    `<!--`,
    `  Stroke-order data for ${literal}, derived from AnimCJK (https://github.com/parsimonhi/animCJK),`,
    ...(kind === "kana"
      ? [
          `  from its svgsJaKana set. Distributed under the GNU Lesser General Public License v3 or`,
          `  later (see LGPL.txt). Regenerated by scripts/build-strokes.ts — do not edit by hand.`
        ]
      : [
          `  itself derived from the Arphic PL KaitiM fonts. Distributed under the Arphic Public License`,
          `  (see ARPHICPL.TXT). Regenerated by scripts/build-strokes.ts — do not edit by hand.`
        ]),
    `-->`,
    `<svg id="${id}" class="acjk" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">`,
    `<g class="glyph">${stampedGlyph.join("")}</g>`,
    `<defs>${defs.trim()}${ARROW_MARKER}</defs>`,
    `<g class="strokes">${stampedStrokes.join("")}</g>`,
    `<g class="guides">${guides}</g>`,
    ...(rects === "" ? [] : [`<g class="parts">${rects}</g>`]),
    `</svg>`,
    ``
  ].join("\n");
};

/** How many source files to fetch at once. Enough to be quick, gentle enough not to get rate-limited. */
const CONCURRENCY = 16;

/**
 * Every kana that can have its own drawing, both scripts (#55 step 3).
 *
 * Derived from the chart the Kana tab renders rather than listed again here, so a cell added there
 * cannot end up without a drawing to open.
 *
 * SINGLE code points only. A digraph is two characters (きゃ = き + small ゃ), and the host serves a
 * drawing by one-code-point filename — `#strokeSvg` checks exactly that before touching the disk.
 * Upstream has no combined drawing for them either. The chart handles this by making digraph cells
 * inert, so this filter and that decision have to stay in agreement.
 */
const chartKana = (): string[] => {
  const singles = KANA_CHART.flatMap((section) =>
    section.rows.flatMap((row) =>
      row.cells
        .filter((cell) => cell !== undefined)
        .map((cell) => cell.kana)
        .filter((kana) => Array.from(kana).length === 1)
    )
  );
  // Both scripts: the chart stores hiragana and derives katakana for display, but a drawing is a
  // file per literal, so the katakana twin needs fetching in its own right.
  return [...singles, ...singles.map(toKatakana)];
};

/**
 * Fetch and transform every kanji in the manifest (the Japanese subset our dictionary surfaces).
 * Missing-upstream (404, benign) and transform-failed (our bug — fail loudly) are counted apart so
 * one can never hide the other.
 */
const main = async (): Promise<void> => {
  const manifest = readFileSync(join(OUT_DIR, "MANIFEST.txt"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  // CJK Compatibility Ideographs (U+F900-FAFF) decompose to a unified codepoint, and macOS treats
  // the pair as ONE filename — shipping both makes the repo uncheckoutable there. Drop the compat
  // twin; #strokeSvg normalizes on read, so its codepoint still finds the unified drawing.
  const kanji = manifest.filter(
    (l) => l.normalize("NFC") === l || !manifest.includes(l.normalize("NFC"))
  );
  const collapsed = manifest.length - kanji.length;
  if (collapsed > 0)
    console.log(`  skipping ${collapsed} compatibility-ideograph duplicates`);

  // Kana are appended rather than added to MANIFEST.txt: the manifest is the set of characters the
  // DICTIONARY surfaces (it is generated from Kanjidic), while these come from a static chart. Two
  // different sources of truth, kept apart so regenerating one cannot silently rewrite the other.
  const kana = new Set(chartKana());
  const literals = [...kanji, ...kana];
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(KANA_OUT_DIR, { recursive: true });
  const acjkMap = await fetchAcjkMap();

  let done = 0;
  let withParts = 0;
  const missing: string[] = [];
  const broken: Array<{ literal: string; error: string }> = [];

  const process = async (literal: string): Promise<void> => {
    const codepoint = literal.codePointAt(0);
    if (codepoint === undefined) return;
    // Kana are in their own upstream directory (asking svgsJa for あ 404s) and land in their own
    // output directory, under their own licence.
    const isKana = kana.has(literal);
    const base = isKana ? KANA_SOURCE_BASE : SOURCE_BASE;
    const res = await fetch(`${base}/${codepoint}.svg`, {
      headers: { "User-Agent": "vscode-jisho-build" }
    });
    if (!res.ok) {
      missing.push(literal);
      return;
    }
    const source = await res.text();
    try {
      const acjk = acjkMap.get(literal);
      const parsed = acjk === undefined ? null : parseAcjk(literal, acjk);
      const svg = transform(
        source,
        literal,
        parsed?.parts ?? null,
        isKana ? "kana" : "kanji"
      );
      // Named by CODEPOINT, which is also how upstream serves them — see `strokeSvgName` for the
      // two environments a literal filename broke in. `#strokeSvg` derives the same name to read.
      writeFileSync(
        join(isKana ? KANA_OUT_DIR : OUT_DIR, `${codepoint}.svg`),
        svg,
        "utf8"
      );
      if (svg.includes(`<g class="parts">`)) withParts++;
      done++;
    } catch (error) {
      broken.push({
        literal,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // A simple worker pool: each worker pulls the next index until the list is exhausted.
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= literals.length) return;
        await process(literals[i]);
        if (done > 0 && done % 500 === 0) {
          console.log(`  …${done}/${literals.length}`);
        }
      }
    })
  );

  console.log(`Transformed ${done}/${literals.length} stroke SVGs.`);
  console.log(`  ${withParts} carry part hit-targets (acjk decomposition).`);
  if (missing.length > 0) {
    console.log(
      `  ${missing.length} not in AnimCJK upstream: ${missing.slice(0, 20).join("")}${missing.length > 20 ? "…" : ""}`
    );
  }
  // Fail loudly: a transform error means we misread the source format, and quietly shipping 3,820 of
  // 3,821 files would hide it.
  if (broken.length > 0) {
    for (const b of broken)
      console.error(`  TRANSFORM FAILED ${b.literal}: ${b.error}`);
    throw new Error(`${broken.length} characters failed to transform`);
  }
};

// Only run when invoked directly — the transform is imported by tests.
if (process.argv[1]?.endsWith("build-strokes.ts")) {
  await main();
}
