import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import svg from "../../../../assets/kanji-svgs/近.svg?raw";
import { StrokePlayer } from "../StrokePlayer";

/**
 * 近 (7 strokes) is the candidate character throughout: few enough to reason about, enough to catch
 * off-by-ones.
 *
 * These assert BEHAVIOUR, not mechanism. The previous suite passed while the player was unusable
 * because it checked static outcomes ("after an arrow key, 3 strokes are drawn") — which is also
 * true if the input restarted the whole animation and it happened to reach 3. So every test here
 * pins what actually separates working from broken:
 *   - does an input RESTART the animation? (it must not)
 *   - is the animation PAUSED after a seek? (it must be)
 *   - does the slider ADVANCE by itself while playing? (it must)
 *   - does each of several distinct seek positions show exactly the right strokes?
 */
const ms = (strokes: number): number => strokes * 600;

const strokes = (): SVGPathElement[] => [
  ...document.querySelectorAll<SVGPathElement>("svg.acjk .strokes path")
];

/** A stroke's dash offset as a number, whatever form the engine reports it in. */
const dashOffset = (path: SVGPathElement): number =>
  Number.parseFloat(
    getComputedStyle(path).strokeDashoffset.replace(/^calc\(|px\)?$/g, "")
  );

/** How many strokes are FULLY drawn (offset pulled all the way to 0). */
const drawn = (): number => strokes().filter((p) => dashOffset(p) === 0).length;

/**
 * How many strokes are partway drawn. Should be at most 1 — the one the playhead is crossing.
 * This is the measurement the old suite lacked: it only counted offset === 0, so a player that
 * SNAPPED each stroke from hidden to complete (no drawing at all) passed every assertion.
 */
const partial = (): number =>
  strokes().filter((p) => {
    const offset = dashOffset(p);
    return offset > 0 && offset < 3339;
  }).length;

const clock = (): Animation => {
  const anim = document
    .querySelector("[class*='canvas']")
    ?.getAnimations()
    .find((a) => a instanceof CSSAnimation);
  if (!anim) throw new Error("the player has no animation to drive");
  return anim;
};

const slider = (): HTMLElement => screen.getByRole("slider");
const sliderValue = (): number => Number(slider().getAttribute("value"));

const play = async (): Promise<void> => {
  await userEvent.click(screen.getByRole("button", { name: "Play animation" }));
};

const wait = async (duration: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, duration));
};

describe("stroke player: playback", () => {
  afterEach(cleanup);

  it("shows nothing and stays paused until asked", () => {
    // WHY: the original bug — the SVG animated itself the instant it hit the DOM.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    expect(drawn()).toBe(0);
    expect(clock().playState).toBe("paused");
    expect(sliderValue()).toBe(0);
  });

  it("advances the slider on its own while playing", async () => {
    // WHY: the slider must TRACK playback, like dmak's. Nothing drove it before — the value only
    // moved when the user did, so the handle sat at 0 while the character drew itself.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    await play();
    await wait(ms(2.5));
    const mid = sliderValue();
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(7);
    await wait(ms(2));
    expect(sliderValue()).toBeGreaterThan(mid); // still climbing
  });

  it("draws each stroke progressively rather than snapping it on", async () => {
    // WHY: the bug this suite missed. The old rule was `if(playhead >= index: 0; else: 3339)` — two
    // possible values, so a stroke was either invisible or complete and could never animate. It
    // looked like jumping from keyframe to keyframe. Every assertion still passed, because they only
    // ever counted fully-drawn strokes: the measurement was blind to the failure.
    // Mid-playback there must be exactly one stroke caught in the act of being drawn.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    await play();
    await wait(ms(2.5));
    expect(partial()).toBe(1);
    // …and it must be the one right after the finished ones.
    const offsets = strokes().map(dashOffset);
    const drawing = offsets.findIndex((o) => o > 0 && o < 3339);
    expect(drawing).toBe(drawn()); // 0-indexed: strokes before it are done
  });

  it("draws a stroke smoothly across its own span", async () => {
    // WHY: "partial" isn't enough — the offset must actually TRAVEL. Sampling the same stroke twice
    // shows the dash retracting, which is the drawing effect itself.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    await play();
    await wait(ms(0.25));
    const early = dashOffset(strokes()[0]);
    await wait(ms(0.5));
    const later = dashOffset(strokes()[0]);
    expect(early).toBeGreaterThan(0);
    expect(later).toBeLessThan(early); // the dash is retracting = the stroke is being drawn
  });

  it("resumes from where it paused instead of restarting", async () => {
    // WHY: THE bug. Every input restarted the animation, because the effect re-seeked and replayed on
    // any state change. Pause then play must continue — the playhead may not go backwards.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    await play();
    await wait(ms(3));
    await userEvent.click(
      screen.getByRole("button", { name: "Pause animation" })
    );
    const pausedAt = Number(clock().currentTime);
    expect(pausedAt).toBeGreaterThan(0);

    await play();
    expect(Number(clock().currentTime)).toBeGreaterThanOrEqual(pausedAt);
  });

  it("keeps the picture and the slider in step when paused", async () => {
    // WHY: pause must land on what the user SEES. A slider reading 3 over 2 drawn strokes is a lie.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    await play();
    await wait(ms(3.5));
    await userEvent.click(
      screen.getByRole("button", { name: "Pause animation" })
    );
    expect(clock().playState).toBe("paused");
    expect(sliderValue()).toBe(drawn());
  });
});

describe("stroke player: seeking", () => {
  afterEach(cleanup);

  it("draws exactly the sought strokes at every position", async () => {
    // WHY: the core promise of a seek slider, checked at MULTIPLE points — a single position can pass
    // by luck (or by restarting and racing to the right count). Every stop must be exact.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    slider().focus();
    for (const target of [1, 2, 3, 4, 5, 6, 7]) {
      await userEvent.keyboard("{ArrowRight}");
      expect(sliderValue()).toBe(target);
      expect(drawn()).toBe(target);
    }
    // …and back down: seeking must be reversible, not just forward.
    for (const target of [6, 5, 4, 3, 2, 1, 0]) {
      await userEvent.keyboard("{ArrowLeft}");
      expect(sliderValue()).toBe(target);
      expect(drawn()).toBe(target);
    }
  });

  it("pauses playback when the user grabs the slider", async () => {
    // WHY: the user takes over. An animation still running under a scrub fights the input and the
    // handle jumps back — seeking has to stop the clock, not race it.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    await play();
    await wait(ms(1.5));
    expect(clock().playState).toBe("running");

    slider().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(clock().playState).toBe("paused");
  });

  it("does not restart the animation when seeking", async () => {
    // WHY: seeking to stroke 5 must SHOW stroke 5, not rewind to 0 and animate up to it. That
    // restart-on-every-input is exactly what made the player unusable.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    slider().focus();
    for (let i = 0; i < 5; i++) await userEvent.keyboard("{ArrowRight}");
    expect(sliderValue()).toBe(5);
    // Immediately — no waiting for an animation to catch up.
    expect(drawn()).toBe(5);
    expect(clock().playState).toBe("paused");
  });

  it("resumes from a seeked position rather than the beginning", async () => {
    // WHY: seek to 5, press play, and it must carry on from 5. Restarting would throw away the
    // position the user just chose.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    slider().focus();
    for (let i = 0; i < 5; i++) await userEvent.keyboard("{ArrowRight}");
    await play();
    expect(Number(clock().currentTime)).toBeGreaterThanOrEqual(ms(5) - 50);
  });

  it("replay rewinds to the start", async () => {
    // WHY: replay is the one control that SHOULD rewind — the counterpart to play resuming.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    slider().focus();
    for (let i = 0; i < 5; i++) await userEvent.keyboard("{ArrowRight}");
    expect(drawn()).toBe(5);
    await userEvent.click(
      screen.getByRole("button", { name: "Restart animation" })
    );
    expect(Number(clock().currentTime)).toBeLessThan(ms(1));
  });
});

describe("stroke player: guides", () => {
  afterEach(cleanup);

  const guideOpacity = (strokeNumber: number): number => {
    const marker = document.querySelector<SVGElement>(
      `svg.acjk .guides text.g${strokeNumber}`
    );
    return marker ? Number(getComputedStyle(marker).opacity) : -1;
  };

  it("shows only the upcoming stroke's guide", () => {
    // WHY: the guide says "start here, go this way" for the stroke about to be drawn. All of them at
    // once is unreadable noise — which is what shipped.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    expect(guideOpacity(1)).toBe(1); // next up
    expect(guideOpacity(2)).toBe(0);
    expect(guideOpacity(7)).toBe(0);
  });

  it("moves the guide along as strokes are drawn", async () => {
    // WHY: the guide has to follow the playhead. After seeking to stroke 3, the guide belongs on
    // stroke 4 — the next one — and stroke 1's is long done.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    slider().focus();
    for (let i = 0; i < 3; i++) await userEvent.keyboard("{ArrowRight}");
    expect(guideOpacity(1)).toBe(0); // already drawn
    expect(guideOpacity(3)).toBe(0); // already drawn
    expect(guideOpacity(4)).toBe(1); // next up
    expect(guideOpacity(5)).toBe(0); // not yet
  });

  it("hides every guide once the character is finished", async () => {
    // WHY: at the end there is no next stroke, so nothing should linger over the completed glyph.
    render(<StrokePlayer svg={svg} strokeCount={7} />);
    slider().focus();
    for (let i = 0; i < 7; i++) await userEvent.keyboard("{ArrowRight}");
    expect(drawn()).toBe(7);
    for (let n = 1; n <= 7; n++) expect(guideOpacity(n)).toBe(0);
  });
});
