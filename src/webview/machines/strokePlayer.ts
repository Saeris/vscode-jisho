/**
 * Stroke-order animation player (XState). Pure UI state driving the CSS-animated stroke SVG on the
 * stroke-order view — mirrors the navigation machine's "UI state lives in XState" role.
 *
 * The SVG animates via CSS: each stroke path draws with `stroke-dashoffset` on a keyframe, staggered
 * by a per-stroke `animation-delay`. The machine exposes play/pause/replay and — the point of the
 * seekable design — a `strokeIndex` the view maps onto how many strokes are revealed.
 *
 * `strokeIndex` ALWAYS holds a meaningful position (0 = nothing drawn, strokeCount = fully drawn),
 * rather than the earlier `steppedTo: number | null` + separate `stepped` state. A slider needs a
 * position at all times — during playback, while paused, and while scrubbing — so "am I stepping?"
 * was a distinction the UI could not honour. Collapsing it removes a state and the awkward
 * stepped→play transition that had to clear the step position.
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
   * How many strokes are revealed: 0 = blank, strokeCount = complete. The slider's value, and what
   * the view uses to reveal strokes when not animating.
   */
  strokeIndex: number;
}

/**
 * The character's stroke count, known by the view before the machine starts (it's counted from the
 * SVG markup). Passed as input rather than left to a `load` event: every seek is clamped to
 * 0..strokeCount, so a machine that starts at 0 clamps everything to 0 — the slider pins itself at
 * zero until the event arrives, if it ever does.
 */
export interface StrokeInput {
  strokeCount: number;
}

export type StrokeEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "replay" }
  /** The view reporting that the CSS animation ran to its end. */
  | { type: "finished" }
  /** Jump to an absolute position (the slider). Clamped to 0..strokeCount. */
  | { type: "seek"; index: number }
  /** Reveal one more stroke — `seek` relative to the current position. */
  | { type: "step" }
  /** Hide one stroke — the slider's other direction, and a Back-style study control. */
  | { type: "stepBack" };

/** Keep a requested position inside 0..strokeCount, whatever the caller asks for. */
const clamp = (index: number, strokeCount: number): number =>
  Math.max(0, Math.min(index, strokeCount));

export const strokePlayerMachine = setup({
  types: {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    context: {} as StrokeContext,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    events: {} as StrokeEvent,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    input: {} as StrokeInput
  },
  actions: {
    restart: assign({
      runId: ({ context }) => context.runId + 1,
      strokeIndex: () => 0
    }),
    /** Playback finished (or was scrubbed to the end): the character stands fully drawn. */
    complete: assign({
      strokeIndex: ({ context }) => context.strokeCount
    }),
    seek: assign({
      strokeIndex: ({ context, event }) =>
        event.type === "seek"
          ? clamp(event.index, context.strokeCount)
          : context.strokeIndex
    }),
    advance: assign({
      strokeIndex: ({ context }) =>
        clamp(context.strokeIndex + 1, context.strokeCount)
    }),
    retreat: assign({
      strokeIndex: ({ context }) =>
        clamp(context.strokeIndex - 1, context.strokeCount)
    })
  }
}).createMachine({
  id: "strokePlayer",
  initial: "paused",
  context: ({ input }) => ({
    strokeCount: input.strokeCount,
    runId: 0,
    strokeIndex: 0
  }),
  on: {
    // Scrubbing always takes control of playback: you cannot meaningfully seek while the animation
    // is also advancing, so any seek/step lands in `paused` at the requested position.
    seek: { target: ".paused", actions: "seek" },
    step: { target: ".paused", actions: "advance" },
    stepBack: { target: ".paused", actions: "retreat" }
  },
  states: {
    // The resting state: nothing animates, `strokeIndex` strokes are shown. Also where a fresh view
    // starts — the player never autoplays (the view additionally honours reduced-motion).
    paused: {
      on: {
        play: { target: "playing", actions: "restart" },
        replay: { target: "playing", actions: "restart" }
      }
    },
    playing: {
      on: {
        pause: "paused",
        replay: { target: "playing", actions: "restart", reenter: true },
        // The view reports the animation reaching its end, so the slider lands on "complete"
        // instead of stranding at whatever position playback started from.
        finished: { target: "paused", actions: "complete" }
      }
    }
  }
});
