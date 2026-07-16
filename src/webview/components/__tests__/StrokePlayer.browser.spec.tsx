import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import svg from "../../../../assets/kanji-svgs/近.svg?raw";
import { StrokePlayer } from "../StrokePlayer";

/**
 * The stroke player's whole seeking mechanism is CSS behaviour on injected markup, so it is tested
 * in a real browser: jsdom neither runs animations nor resolves the `calc()`/custom-property
 * arithmetic these rules depend on.
 *
 * The trick under test (documented in StrokePlayer.module.css): each stroke carries its index as a
 * delay (`--d: Ns`), so offsetting every stroke's animation-delay by `--stroke-index` seconds leaves
 * strokes 1..N already finished and the rest not yet started — i.e. "the first N strokes are drawn".
 */
const strokes = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>("svg.acjk path[clip-path]")
];

/** A stroke is visible once its animation has run past the end (dashoffset drawn to 0). */
const delayOf = (el: HTMLElement): number =>
  Number.parseFloat(getComputedStyle(el).animationDelay);

describe("stroke player seeking (real CSS)", () => {
  afterEach(cleanup);

  it("shows nothing at rest", () => {
    // WHY: the player must open on a blank frame — the first render is a still, and a character that
    // arrives already drawn gives the user nothing to watch and no reason to press play.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    // At index 0 every stroke's seek must land BEFORE its own draw begins (a positive delay means
    // "hasn't started"). Stroke 1's delay is 1s - 0s - 0.8s = +0.2s.
    for (const stroke of strokes()) expect(delayOf(stroke)).toBeGreaterThan(0);
  });

  it("pauses the animation while at rest", () => {
    // WHY: if the animation were running, the negative-delay seek would be a starting point rather
    // than a fixed position — strokes would keep appearing on their own under the slider.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    for (const stroke of strokes()) {
      expect(getComputedStyle(stroke).animationPlayState).toBe("paused");
    }
  });

  it("overrides the delay the SVG sets in its own inline style", () => {
    // WHY: the SVG declares its own `animation` in an inline <style>. This asserts our rule wins —
    // without it the strokes would follow the SVG's fixed timeline and ignore the slider entirely.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    const first = strokes()[0];
    // The SVG's own value would be a bare 1s; ours is 1s - 0s - 0.8s = 0.2s.
    expect(delayOf(first)).toBeCloseTo(0.2, 2);
  });

  it("keeps the character's filled shapes as a faint guide, not the drawing itself", () => {
    // WHY: AnimCJK ships the glyph twice — solid `path[id]` shapes plus the animated `path[clip-path]`
    // strokes clipped to them. The filled shapes are STATIC, so at full opacity they render the whole
    // character regardless of the seek: the player looked complete at stroke 0 while every assertion
    // about the animated strokes passed. They must stay faint, or the seek is invisible.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    const filled = [
      ...document.querySelectorAll<HTMLElement>("svg.acjk path[id]")
    ];
    expect(filled.length).toBeGreaterThan(0);
    for (const shape of filled) {
      expect(Number(getComputedStyle(shape).opacity)).toBeLessThan(0.5);
    }
  });

  it("seeks the drawing forward as the slider advances", async () => {
    // WHY: this is the feature. Arrowing the slider must actually redraw — each step has to push one
    // more stroke past its finish line, which shows up as every delay shifting a full second
    // earlier. Asserting the machine's index alone would pass even if the CSS ignored it entirely.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    const before = strokes().map(delayOf);

    // React Aria renders the thumb as a real (visually hidden) <input type="range">, which is what
    // carries the implicit `slider` role and the native arrow-key handling — so drive that.
    const thumb = screen.getByRole("slider");
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(thumb).toHaveValue("1");
    const after = strokes().map(delayOf);
    after.forEach((delay, i) => expect(delay).toBeCloseTo(before[i] - 1, 2));
  });

  it("hands the timeline back to the SVG's own stagger while playing", async () => {
    // WHY: playback and seeking are mutually exclusive modes. During playback the strokes must run on
    // the SVG's natural 1s-per-stroke stagger (delay = --d) rather than the seeked offset, or the
    // animation would start mid-character wherever the slider happened to be.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Play animation" })
    );
    // Stroke 1's natural delay is a bare 1s.
    expect(delayOf(strokes()[0])).toBeCloseTo(1, 2);
    expect(getComputedStyle(strokes()[0]).animationPlayState).toBe("running");
  });
});
