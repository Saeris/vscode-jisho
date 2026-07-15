import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PitchAccent } from "../PitchAccent";

/**
 * The pitch contour is a LAYOUT problem, so it's tested in a real browser.
 *
 * Two bugs shipped here with a fully green jsdom suite, and neither was observable without a layout
 * engine: (1) per-mora CSS borders can't draw a line that spans moras, so the "overline" came out as
 * disconnected fragments with a stray tick at the downstep; (2) the SVG replacement silently
 * collapsed to its ~3px intrinsic width, because an absolutely-positioned child of a grid resolves
 * against its grid area — `inset-inline: 0` never stretched it. jsdom reports zero-size boxes and
 * resolves no real styles, so it cannot see either failure.
 *
 * So these assert what jsdom can't: computed geometry. The polyline's *topology* (which moras are
 * high, where the drop lands) is covered by `pitch.spec.ts` against the pure functions — no need to
 * pay for a browser to re-test that.
 */

/** The contour's rendered geometry, read back from real layout. */
const geometry = (): {
  svgWidth: number;
  trackWidth: number;
  moraCount: number;
  strokeBox: { width: number; height: number };
} => {
  const svg = document.querySelector("svg");
  const poly = document.querySelector("polyline");
  if (!svg || !poly) throw new Error("contour did not render");
  const track = svg.parentElement;
  const strokeRect = poly.getBoundingClientRect();
  return {
    svgWidth: svg.getBoundingClientRect().width,
    trackWidth: track?.getBoundingClientRect().width ?? 0,
    moraCount: document.querySelectorAll("[data-mora]").length,
    strokeBox: { width: strokeRect.width, height: strokeRect.height }
  };
};

describe("pitch accent contour (real layout)", () => {
  afterEach(cleanup);

  it("stretches the contour across the full width of the kana", () => {
    // WHY: this is the exact bug that shipped. The SVG must span the mora track — when it collapsed
    // to its ~3px intrinsic width the contour rendered as a stub next to the word, while every
    // jsdom assertion still passed. Anything much narrower than the track is that failure.
    render(<PitchAccent reading="たべる" accents={[2]} />);
    const { svgWidth, trackWidth } = geometry();
    expect(trackWidth).toBeGreaterThan(10); // sanity: the track itself laid out
    expect(svgWidth).toBeGreaterThanOrEqual(trackWidth * 0.95);
  });

  it("draws a stroke that spans moras and changes level", () => {
    // WHY: guards the per-mora-border failure mode. A contour for たべる[2] rises and falls, so the
    // drawn stroke must have real extent on BOTH axes — a flat line (no height) means the verticals
    // never rendered; a narrow one means it isn't crossing moras.
    render(<PitchAccent reading="たべる" accents={[2]} />);
    const { strokeBox, trackWidth } = geometry();
    expect(strokeBox.width).toBeGreaterThanOrEqual(trackWidth * 0.9);
    expect(strokeBox.height).toBeGreaterThan(4); // the rise + fall have vertical extent
  });

  it("keeps the contour clear of the kana glyphs", () => {
    // WHY: the first SVG attempt drew the line THROUGH the text — verticals slicing neighbouring
    // glyphs, low line clipping descenders — which read as a box around the accent mora. The band
    // must sit entirely above the kana, so the polyline's bottom must not reach the glyph tops.
    render(<PitchAccent reading="たべる" accents={[2]} />);
    const poly = document.querySelector("polyline");
    const mora = screen.getByText("た");
    const lineBottom = poly?.getBoundingClientRect().bottom ?? 0;
    const glyphTop = mora.getBoundingClientRect().top;
    expect(lineBottom).toBeLessThanOrEqual(glyphTop + 1); // +1px tolerance for subpixel rounding
  });

  it("scales the contour with the reading's length", () => {
    // WHY: the grid is one column per mora, which is what makes the SVG's x-coordinates line up with
    // glyphs at ANY width. A longer reading must produce a proportionally wider contour — if it
    // didn't, the vertices would drift off their moras as words get longer.
    render(<PitchAccent reading="たべる" accents={[2]} />);
    const short = geometry().svgWidth;
    cleanup();
    render(<PitchAccent reading="とうきょう" accents={[0]} />);
    const long = geometry().svgWidth;
    expect(long).toBeGreaterThan(short);
  });

  it("renders every mora as its own column", () => {
    // WHY: the x-coordinates are only meaningful if columns and moras correspond 1:1. とうきょう is
    // 4 moras (と・う・きょ・う) from 5 characters — a char-based grid would shift every vertex.
    render(<PitchAccent reading="とうきょう" accents={[0]} />);
    expect(geometry().moraCount).toBe(4);
    expect(screen.getByText("きょ")).toBeDefined();
  });
});
