import { useQuery } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import { Button } from "react-aria-components";
import { strokePlayerMachine } from "../machines/strokePlayer";
import { strokeSvgQuery } from "../queries";
import styles from "./StrokePlayer.module.css";

/** Count strokes in the SVG markup: each animated stroke is a `clip-path`'d path (AnimCJK shape). */
const countStrokes = (svg: string): number =>
  (svg.match(/clip-path=/g) ?? []).length;

/**
 * Stroke-order animation player for the kanji detail. Fetches the character's SVG (AnimCJK, from the
 * DB), injects it, and drives play/pause/replay/step through the XState player machine. The SVG's
 * own CSS animates each stroke via `stroke-dashoffset` staggered by `animation-delay`; we map the
 * machine state onto `animation-play-state` and remount (via `runId`) to restart. Autoplay is
 * suppressed under `prefers-reduced-motion` — the user presses play.
 */
export const StrokePlayer = ({
  literal
}: {
  literal: string;
}): React.ReactElement | null => {
  const { data: svg, isPending } = useQuery(strokeSvgQuery(literal));
  const [state, send] = useMachine(strokePlayerMachine);

  if (isPending) return <p className={styles.status}>Loading strokes…</p>;
  if (svg === null || svg === undefined) return null; // no animation for this character

  const strokeCount = countStrokes(svg);
  const playing = state.matches("playing");
  const stepped = state.matches("stepped");

  return (
    <div className={styles.container}>
      <div
        // runId in the key remounts the SVG on replay/play-from-start, which restarts CSS animations.
        key={state.context.runId}
        className={styles.canvas}
        data-playing={playing ? "true" : "false"}
        data-stepped={stepped ? String(state.context.steppedTo) : undefined}
        // The SVG comes from our own build (assets/kanji-svgs), not user input — safe to inject.
        // oxlint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
        onAnimationStart={() =>
          state.matches("idle") && send({ type: "load", strokeCount })
        }
      />
      <div className={styles.controls}>
        {playing ? (
          <Button
            className={styles.control}
            onPress={() => send({ type: "pause" })}
          >
            Pause
          </Button>
        ) : (
          <Button
            className={styles.control}
            onPress={() => send({ type: "play" })}
          >
            Play
          </Button>
        )}
        <Button
          className={styles.control}
          onPress={() => send({ type: "step" })}
        >
          Step
        </Button>
        <Button
          className={styles.control}
          onPress={() => send({ type: "replay" })}
        >
          Replay
        </Button>
      </div>
    </div>
  );
};
