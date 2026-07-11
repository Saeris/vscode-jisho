/**
 * Stroke-order animation player (XState). Pure UI state driving the CSS-animated stroke SVG on the
 * kanji detail view — mirrors the navigation machine's "UI state lives in XState" role.
 *
 * The SVG animates via CSS: each stroke path draws with `stroke-dashoffset` on a keyframe, staggered
 * by a per-stroke `animation-delay`. The machine's job is only to expose play/pause/replay/step as
 * discrete states+events; the view maps `playing`/`paused` onto `animation-play-state` and drives a
 * `replay` by remounting the SVG (a fresh element restarts CSS animations). `step` is a paused-mode
 * control that advances the visible stroke count by one.
 */
import { assign, setup } from "xstate";

export interface StrokeContext {
  /** Total strokes in the current character (set when the SVG loads). */
  strokeCount: number;
  /**
   * A monotonically increasing token; bumping it remounts the SVG to restart the CSS animation.
   * Used by `replay` and whenever a fresh play from the start is wanted.
   */
  runId: number;
  /**
   * In stepped mode, how many strokes are revealed. `null` means "not stepping" (normal playback
   * reveals all strokes over time). Set by `step`.
   */
  steppedTo: number | null;
}

export type StrokeEvent =
  | { type: "load"; strokeCount: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "replay" }
  | { type: "step" };

export const strokePlayerMachine = setup({
  types: {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    context: {} as StrokeContext,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    events: {} as StrokeEvent
  },
  actions: {
    setCount: assign({
      strokeCount: ({ context, event }) =>
        event.type === "load" ? event.strokeCount : context.strokeCount
    }),
    restart: assign({
      runId: ({ context }) => context.runId + 1,
      steppedTo: () => null
    }),
    advance: assign({
      // Reveal one more stroke, capped at the total. First step from normal playback starts at 1.
      steppedTo: ({ context }) =>
        Math.min((context.steppedTo ?? 0) + 1, context.strokeCount)
    })
  }
}).createMachine({
  id: "strokePlayer",
  initial: "idle",
  context: { strokeCount: 0, runId: 0, steppedTo: null },
  on: {
    load: { actions: "setCount" }
  },
  states: {
    idle: {
      on: {
        play: { target: "playing", actions: "restart" },
        step: { target: "stepped", actions: "advance" }
      }
    },
    playing: {
      on: {
        pause: "paused",
        replay: { target: "playing", actions: "restart" }
      }
    },
    paused: {
      on: {
        play: "playing",
        replay: { target: "playing", actions: "restart" },
        step: { target: "stepped", actions: "advance" }
      }
    },
    // Stepped mode: strokes are revealed one at a time via `steppedTo`, animation paused between.
    stepped: {
      on: {
        step: { actions: "advance" },
        play: { target: "playing", actions: "restart" },
        replay: { target: "idle", actions: "restart" }
      }
    }
  }
});
