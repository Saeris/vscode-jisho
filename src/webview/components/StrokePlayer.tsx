import { useMachine } from "@xstate/react";
import {
  Button,
  Label,
  Slider,
  SliderThumb,
  SliderTrack
} from "react-aria-components";
import { strokePlayerMachine } from "../machines/strokePlayer";
import styles from "./StrokePlayer.module.css";

/**
 * Stroke-order animation player. Takes the character's SVG (AnimCJK, fetched by the parent view),
 * injects it, and drives play/pause/replay plus a **seek slider** through the XState player machine.
 *
 * Two rendering modes share one SVG:
 *  - **playing** — the SVG's own CSS animates each stroke via `stroke-dashoffset`, staggered by a
 *    per-stroke `animation-delay` (`--d`). We only toggle `animation-play-state` and remount (via
 *    `runId`) to restart.
 *  - **paused/seeking** — the animation is off and `--stroke-index` decides which strokes are drawn
 *    (CSS compares each stroke's index against it). This is what makes the slider possible: revealing
 *    stroke N is a static question, not a point on a timeline.
 *
 * Autoplay is suppressed under `prefers-reduced-motion` — the user presses play.
 */
export const StrokePlayer = ({
  svg,
  strokeCount
}: {
  svg: string;
  strokeCount: number;
}): React.ReactElement => {
  const [state, send] = useMachine(strokePlayerMachine, {
    // The machine clamps every seek to 0..strokeCount, so it must know the count from the very first
    // render — otherwise it clamps to a count of 0 and the slider silently pins itself at zero.
    input: { strokeCount }
  });
  const playing = state.matches("playing");
  const { strokeIndex } = state.context;

  return (
    <div className={styles.container}>
      <div
        // runId in the key remounts the SVG on replay/play-from-start, which restarts CSS animations.
        key={state.context.runId}
        className={styles.canvas}
        data-playing={playing ? "true" : "false"}
        style={strokeVars(strokeIndex)}
        // The SVG comes from our own build (assets/kanji-svgs), not user input — safe to inject.
        // oxlint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
        onAnimationEnd={(event) => {
          // Each stroke ends its own animation; the LAST one ending means playback is complete.
          // Without this the slider would still read the position playback started from.
          if (playing && event.animationName.includes("zk")) {
            send({ type: "finished" });
          }
        }}
      />

      <div className={styles.controls}>
        <Button
          className={styles.control}
          // Explicit names: "Play" and "Replay" are ambiguous to a screen reader searching by name
          // (and to any name-based query), since one contains the other.
          aria-label={playing ? "Pause animation" : "Play animation"}
          onPress={() => send({ type: playing ? "pause" : "play" })}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </Button>
        <Button
          className={styles.control}
          aria-label="Restart animation"
          onPress={() => send({ type: "replay" })}
        >
          ↺ Replay
        </Button>
      </div>

      {/* The seek slider: scrub the character one stroke at a time. Arrow keys step natively, which
          is why this replaced the old Step button — the affordance covers both. */}
      <Slider
        className={styles.slider}
        value={strokeIndex}
        minValue={0}
        maxValue={strokeCount}
        step={1}
        // A single-thumb Slider reports a plain number (the array form is for multi-thumb).
        onChange={(index) => send({ type: "seek", index })}
      >
        <div className={styles.sliderHeader}>
          <Label className={styles.sliderLabel}>Stroke</Label>
          <span className={styles.sliderValue}>
            {strokeIndex} / {strokeCount}
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

/**
 * `--stroke-index` drives which strokes are visible while paused. React's CSSProperties has no index
 * signature for `--*` names; intersecting it with the custom key states that honestly (an additional
 * property, not a narrowing — so no cast is needed).
 */
const strokeVars = (
  strokeIndex: number
): React.CSSProperties & Record<"--stroke-index", number> => ({
  "--stroke-index": strokeIndex
});
