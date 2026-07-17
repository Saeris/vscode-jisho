import { useEffect, useRef, useState } from "react";
import {
  Button,
  Label,
  Slider,
  SliderThumb,
  SliderTrack
} from "react-aria-components";
import styles from "./StrokePlayer.module.css";

/** Milliseconds each stroke takes to draw. Also the unit that converts clock time ↔ stroke number. */
const MS_PER_STROKE = 600;

/**
 * Stroke-order player: play/pause/replay plus a slider that both tracks playback and seeks it.
 *
 * **The CSS animation is the single source of truth.** One `draw-strokes` keyframe animation drives
 * `--stroke-index` from 0 to the stroke count; CSS renders from that (each median reads its own
 * number via `sibling-index()` — see the stylesheet), and this component drives it through the Web
 * Animations API: `currentTime` to seek, `play()`/`pause()` for playback.
 *
 * Nothing mirrors the playhead into React state. An earlier version kept the position in an XState
 * machine and used an effect to sync it onto the clock — so *every* input (play, pause, replay, a
 * slider nudge) re-ran that effect, re-seeked, and restarted the animation. One design flaw, four
 * symptoms. The clock owns the position; React state holds only what the clock can't answer: whether
 * the user has pressed play.
 *
 * The slider position is polled with requestAnimationFrame while playing, because the Web Animations
 * API has no progress event — polling is the documented way to follow a running animation.
 *
 * The animation is declared `paused` in CSS, so it exists from first paint but can never autoplay.
 */
export const StrokePlayer = ({
  svg,
  strokeCount
}: {
  svg: string;
  strokeCount: number;
}): React.ReactElement => {
  const canvas = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  /**
   * The slider's controlled value, in WHOLE strokes. Mirrors the clock for rendering only — never
   * written back to it. Kept whole (not fractional) so the value handed to the slider always matches
   * what the slider itself reports; a re-derived value makes the thumb fight the pointer.
   */
  const [position, setPosition] = useState(0);

  /**
   * The CSS animation driving the playhead. Read off the element rather than looked up by name:
   * CSS Modules hashes the keyframe name at build time, so matching "draw-strokes" finds nothing.
   * The canvas declares exactly one animation.
   */
  const clock = (): Animation | undefined => canvas.current?.getAnimations()[0];

  // Per-character setup: the duration and the keyframes' end value both depend on the stroke count,
  // so they can't be static in the stylesheet.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.style.setProperty("--stroke-count", String(strokeCount));
    clock()?.effect?.updateTiming({ duration: strokeCount * MS_PER_STROKE });
  }, [strokeCount, svg]);

  // Follow the clock while it runs. The Web Animations API fires no progress event, so tracking a
  // running animation means polling — this is what makes the handle travel with the drawing instead
  // of sitting at 0 until the user touches it.
  //
  // Floored on the way IN: `position` is the slider's controlled value, and the slider deals in whole
  // strokes. Storing the clock's fractional time here and flooring at render made the value React
  // Aria received differ from the one it just reported during a drag, so the thumb fought the pointer
  // and stuck at the ends of the track.
  useEffect((): (() => void) | undefined => {
    if (!playing) return undefined;
    let frame = 0;
    const follow = (): void => {
      const anim = clock();
      if (!anim) return;
      const strokesDrawn = Number(anim.currentTime ?? 0) / MS_PER_STROKE;
      setPosition(Math.min(Math.floor(strokesDrawn), strokeCount));
      if (anim.playState === "finished") {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return (): void => cancelAnimationFrame(frame);
  }, [playing, strokeCount]);

  /**
   * Scrub while the user drags. `onChange` fires on every pointer move, so this is the hot path:
   * move the playhead so the drawing tracks the thumb, and stop playback the moment the user takes
   * over.
   *
   * `position` is set from the slider's own reported value and nothing else. An earlier version
   * derived it (flooring the clock), which desynced the controlled value from what React Aria had
   * just reported — and at 0 specifically, `setPosition(0)` when position was already 0 is a React
   * bail-out, so no re-render happened and the thumb stuck under the pointer. That's why it only
   * misbehaved at one end.
   */
  const scrubTo = (strokeNumber: number): void => {
    const anim = clock();
    if (!anim) return;
    if (anim.playState === "running") anim.pause();
    anim.currentTime = strokeNumber * MS_PER_STROKE;
    setPlaying(false);
    setPosition(strokeNumber);
  };

  const togglePlay = (): void => {
    const anim = clock();
    if (!anim) return;
    if (playing) {
      // pause() holds the playhead where it is — no seek, or we'd lose the position mid-stroke.
      anim.pause();
      setPlaying(false);
      // Floor: mid-draw the clock reads e.g. 3.7 strokes, but only 3 are finished. Rounding up would
      // make the slider claim a stroke the user can't see yet.
      setPosition(Math.floor(Number(anim.currentTime ?? 0) / MS_PER_STROKE));
      return;
    }
    // Replay the run once it's over; otherwise play() resumes from wherever it was paused.
    if (anim.playState === "finished") anim.currentTime = 0;
    anim.play();
    setPlaying(true);
  };

  const replay = (): void => {
    const anim = clock();
    if (!anim) return;
    anim.currentTime = 0;
    anim.play();
    setPlaying(true);
    setPosition(0);
  };

  // `position` is already whole strokes — floored where the clock is read, not here, so the value
  // React Aria gets back is exactly the one it reported.
  const sliderValue = position;

  return (
    <div className={styles.container}>
      <div
        ref={canvas}
        className={styles.canvas}
        // The SVG comes from our own build (assets/kanji-svgs), not user input — safe to inject.
        // oxlint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className={styles.controls}>
        <Button
          className={styles.control}
          // Explicit names: "Play" and "Replay" are ambiguous to a screen reader searching by name
          // (and to any name-based query), since one contains the other.
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

      {/* Tracks playback and seeks it — dragging or arrowing takes over from the animation. */}
      <Slider
        className={styles.slider}
        value={sliderValue}
        minValue={0}
        maxValue={strokeCount}
        step={1}
        // A single-thumb Slider reports a plain number (the array form is for multi-thumb).
        // onChange fires continuously as the user drags — that's what makes the drawing follow the
        // thumb. onChangeEnd fires once on release; it re-commits the final value so the controlled
        // value and React Aria's internal drag state are guaranteed to agree when the drag ends.
        onChange={scrubTo}
        onChangeEnd={scrubTo}
      >
        <div className={styles.sliderHeader}>
          <Label className={styles.sliderLabel}>Stroke</Label>
          <span className={styles.sliderValue}>
            {sliderValue} / {strokeCount}
          </span>
        </div>
        <SliderTrack className={styles.sliderTrack}>
          {({ state: sliderState }) => (
            <>
              <div
                className={styles.sliderFill}
                style={{ width: `${sliderState.getThumbPercent(0) * 100}%` }}
              />
              {/* `index` is required — without it the thumb isn't bound to a track position and
                  arrow keys/drags silently do nothing. */}
              <SliderThumb index={0} className={styles.sliderThumb} />
            </>
          )}
        </SliderTrack>
      </Slider>
    </div>
  );
};
