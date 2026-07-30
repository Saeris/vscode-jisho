import {
  Button,
  Label,
  Slider,
  SliderThumb,
  SliderTrack
} from "react-aria-components";
import styles from "./StrokePlayer.module.css";
import { MS_PER_STROKE, useStrokeClock } from "../useStrokeClock";

// Re-exported: the browser spec imports it from here, and it is the unit this component displays in.
export { MS_PER_STROKE };

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
  const { canvas, playing, position, togglePlay, replay, scrubTo } =
    useStrokeClock(svg, strokeCount);

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
