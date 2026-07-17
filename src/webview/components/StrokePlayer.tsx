import { useEffect, useRef, useState } from "react";
import {
  Button,
  Label,
  Slider,
  SliderThumb,
  SliderTrack
} from "react-aria-components";
import styles from "./StrokePlayer.module.css";

/** Milliseconds per stroke — the unit converting the clock's currentTime ↔ stroke numbers. */
export const MS_PER_STROKE = 600;

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The part hit-rect (if any) at or above an event target — the delegation lookup. */
const partRect = (target: EventTarget | null): SVGRectElement | null =>
  target instanceof Element ? target.closest("rect[data-part]") : null;

/**
 * Stroke-order player. One Web Animation (the "clock") drives `--stroke-index` — the playhead —
 * from 0 to the stroke count; the stylesheet turns that single number into the drawn strokes and
 * guides. JS never touches the SVG: it only plays, pauses, and seeks the clock.
 *
 * Invariant: whenever the clock is paused, currentTime sits on a whole-stroke multiple, so the
 * picture, the clock, and the slider always agree at rest. See docs/STROKE-ORDER.md.
 */
export const StrokePlayer = ({
  svg,
  strokeCount,
  onOpenPart
}: {
  svg: string;
  strokeCount: number;
  /** Called with a part's literal when its hit-target is clicked or keyboard-activated. */
  onOpenPart?: (literal: string) => void;
}): React.ReactElement => {
  const canvas = useRef<HTMLDivElement>(null);
  const clock = useRef<Animation | null>(null);
  const [playing, setPlaying] = useState(false);
  // The slider's controlled value, in whole strokes. Mirrors the clock for display; never derived
  // from anything else, or the thumb fights the pointer (docs/STROKE-ORDER.md, lesson 6).
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

  /** Seek to a whole stroke and take control: a manual seek always stops playback there. */
  const scrubTo = (stroke: number): void => {
    const anim = clock.current;
    if (!anim) return;
    anim.pause();
    anim.currentTime = stroke * MS_PER_STROKE;
    setPlaying(false);
    setPosition(stroke);
  };

  const togglePlay = (): void => {
    const anim = clock.current;
    if (!anim) return;
    if (playing) {
      // Snap down to the last completed stroke (the paused-position invariant).
      anim.pause();
      const stroke = Math.floor(Number(anim.currentTime ?? 0) / MS_PER_STROKE);
      anim.currentTime = stroke * MS_PER_STROKE;
      setPlaying(false);
      setPosition(stroke);
      return;
    }
    if (prefersReducedMotion()) {
      anim.finish();
      return;
    }
    anim.play(); // resumes from the paused position; auto-rewinds only when already finished
    setPlaying(true);
  };

  const replay = (): void => {
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
  };

  // Part highlighting bypasses React state on purpose: hover writes one CSS variable, the
  // stylesheet does the rest — no re-render per pointer move. The rects live inside injected
  // markup, so events are handled by delegation on the canvas.
  const highlight = (target: EventTarget | null): void => {
    canvas.current?.style.setProperty(
      "--hl-part",
      partRect(target)?.dataset.part ?? "0"
    );
  };
  const openPart = (target: EventTarget | null): void => {
    const literal = partRect(target)?.dataset.literal;
    if (literal !== undefined) onOpenPart?.(literal);
  };

  return (
    <div className={styles.container}>
      {/* The interactive elements are the injected rects (role="button", tabindex="0"); the div
          only relays their events. */}
      {/* oxlint-disable-next-line click-events-have-key-events, no-static-element-interactions */}
      <div
        ref={canvas}
        className={styles.canvas}
        onPointerOver={(e) => highlight(e.target)}
        onPointerLeave={() => highlight(null)}
        onFocus={(e) => highlight(e.target)}
        onBlur={() => highlight(null)}
        onClick={(e) => openPart(e.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            if (partRect(e.target) === null) return;
            e.preventDefault();
            openPart(e.target);
          }
        }}
        // Our own build output (assets/kanji-svgs), not user input — safe to inject.
        // oxlint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className={styles.controls}>
        <Button
          className={styles.control}
          // Explicit names: "Play" contains "Replay"'s stem, ambiguous for name-based queries.
          aria-label={playing ? "Pause animation" : "Play animation"}
          onPress={togglePlay}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </Button>
        <Button
          className={styles.control}
          aria-label="Restart animation"
          onPress={replay}
        >
          ↺ Replay
        </Button>
      </div>

      {/* onChange scrubs on every pointer move; onChangeEnd re-commits on release so the controlled
          value and React Aria's drag state agree when the drag ends. */}
      <Slider
        className={styles.slider}
        value={position}
        minValue={0}
        maxValue={strokeCount}
        step={1}
        onChange={scrubTo}
        onChangeEnd={scrubTo}
      >
        <div className={styles.sliderHeader}>
          <Label className={styles.sliderLabel}>Stroke</Label>
          <span className={styles.sliderValue}>
            {position} / {strokeCount}
          </span>
        </div>
        <SliderTrack className={styles.sliderTrack}>
          {({ state: sliderState }) => (
            <>
              <div
                className={styles.sliderFill}
                style={{ width: `${sliderState.getThumbPercent(0) * 100}%` }}
              />
              {/* `index` is required — without it the thumb isn't bound to the track. */}
              <SliderThumb index={0} className={styles.sliderThumb} />
            </>
          )}
        </SliderTrack>
      </Slider>
    </div>
  );
};
