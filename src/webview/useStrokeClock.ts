import { useEffect, useRef, useState } from "react";

/** Milliseconds per stroke — the unit converting the clock's currentTime ↔ stroke numbers. */
export const MS_PER_STROKE = 600;

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface StrokeClock {
  /** Attach to the element the animation is created on. */
  canvas: React.RefObject<HTMLDivElement | null>;
  /** Whether the animation is running. */
  playing: boolean;
  /** Whole strokes drawn, mirroring the clock — the slider's controlled value. */
  position: number;
  /** Play if paused; if playing, pause and snap down to the last completed stroke. */
  togglePlay: () => void;
  /** Restart from the first stroke. */
  replay: () => void;
  /** Seek to a whole stroke. Always lands PAUSED — a manual seek takes control. */
  scrubTo: (stroke: number) => void;
}

/**
 * One `Animation` over the stroke SVG, plus the state a UI needs to follow and drive it.
 *
 * Extracted from `StrokePlayer` so the clock's behaviour is separable from the markup it drives. The
 * rules encoded here are the ones docs/STROKE-ORDER.md records as expensively learned, so they are
 * stated rather than left to be re-derived:
 *
 *  * ONE clock, owned directly. Never `getAnimations()` — fishing the animation back out of the
 *    element is how a second, competing clock appears.
 *  * Created PAUSED. Autoplay is impossible by construction rather than by a later `pause()` call,
 *    because the injected `<style>` used to start the animation the moment markup entered the DOM.
 *  * A seek always pauses and lands on a whole stroke. Two players shipped broken because inputs
 *    restarted the animation instead of moving it; `position` mirrors the clock and is never derived
 *    from anything else, or the slider thumb fights the pointer.
 *  * `pause()` holds position and `play()` resumes (auto-rewinding only a finished animation), so
 *    play/pause is not "restart". WAAPI has no progress event, hence the rAF follower.
 *
 * The two effects here are the legitimate kind: binding an imperative browser API to a ref'd node,
 * and subscribing to a frame loop. Both clean up.
 */
export const useStrokeClock = (
  svg: string,
  strokeCount: number
): StrokeClock => {
  const canvas = useRef<HTMLDivElement>(null);
  const clock = useRef<Animation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return undefined;
    const anim = el.animate(
      [{ "--stroke-index": "0" }, { "--stroke-index": String(strokeCount) }],
      {
        duration: strokeCount * MS_PER_STROKE,
        easing: "linear",
        fill: "forwards"
      }
    );
    anim.pause(); // created at rest — autoplay is impossible by construction
    anim.onfinish = (): void => {
      setPlaying(false);
      setPosition(strokeCount);
    };
    clock.current = anim;
    setPlaying(false);
    setPosition(0);
    return (): void => {
      clock.current = null;
      anim.cancel();
    };
  }, [svg, strokeCount]);

  // The Web Animations API has no progress event, so follow the running clock with rAF to keep the
  // slider handle moving during playback.
  useEffect((): (() => void) | undefined => {
    if (!playing) return undefined;
    let frame = requestAnimationFrame(function follow(): void {
      const anim = clock.current;
      if (!anim) return;
      const strokesDrawn = Number(anim.currentTime ?? 0) / MS_PER_STROKE;
      setPosition(Math.min(Math.floor(strokesDrawn), strokeCount));
      frame = requestAnimationFrame(follow);
    });
    return (): void => cancelAnimationFrame(frame);
  }, [playing, strokeCount]);

  /** Snap the clock to a whole stroke and report it, paused. */
  const settleAt = (anim: Animation, stroke: number): void => {
    anim.pause();
    anim.currentTime = stroke * MS_PER_STROKE;
    setPlaying(false);
    setPosition(stroke);
  };

  return {
    canvas,
    playing,
    position,

    scrubTo: (stroke) => {
      const anim = clock.current;
      if (!anim) return;
      settleAt(anim, stroke);
    },

    togglePlay: () => {
      const anim = clock.current;
      if (!anim) return;
      if (playing) {
        settleAt(
          anim,
          Math.floor(Number(anim.currentTime ?? 0) / MS_PER_STROKE)
        );
        return;
      }
      if (prefersReducedMotion()) {
        anim.finish();
        return;
      }
      anim.play(); // resumes from the paused position; auto-rewinds only when already finished
      setPlaying(true);
    },

    replay: () => {
      const anim = clock.current;
      if (!anim) return;
      anim.currentTime = 0;
      setPosition(0);
      if (prefersReducedMotion()) {
        anim.finish();
        return;
      }
      anim.play();
      setPlaying(true);
    }
  };
};
