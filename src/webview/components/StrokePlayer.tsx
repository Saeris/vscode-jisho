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
  /** Mirrors the clock for rendering only — never written back to it. */
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
  useEffect((): (() => void) | undefined => {
    if (!playing) return undefined;
    let frame = 0;
    const follow = (): void => {
      const anim = clock();
      if (!anim) return;
      const time = Number(anim.currentTime ?? 0);
      setPosition(time / MS_PER_STROKE);
      if (anim.playState === "finished") {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return (): void => cancelAnimationFrame(frame);
  }, [playing]);

  /** Move the playhead and take control: any manual seek stops playback at that exact position. */
  const seekTo = (strokeNumber: number): void => {
    const anim = clock();
    if (!anim) return;
    anim.pause();
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
      setPosition(Number(anim.currentTime ?? 0) / MS_PER_STROKE);
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

  // The slider reports whole strokes; the clock runs continuously. Floor rather than round, so the
  // handle never claims a stroke that isn't finished drawing.
  const sliderValue = Math.min(Math.floor(position), strokeCount);

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
        onChange={seekTo}
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
