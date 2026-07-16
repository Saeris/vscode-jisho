import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { strokePlayerMachine } from "../machines/strokePlayer";

const start = (): ReturnType<
  typeof createActor<typeof strokePlayerMachine>
> => {
  // The stroke count is input, not an event: the view counts strokes from the SVG before the machine
  // starts, and every seek clamps against it — a machine that begins at 0 clamps everything to 0.
  const actor = createActor(strokePlayerMachine, { input: { strokeCount: 9 } });
  actor.start();
  return actor;
};

describe("strokePlayerMachine", () => {
  it("knows its stroke count from the start, before any event", () => {
    // WHY: this is a real bug that shipped into the browser tests. Seeks are clamped to
    // 0..strokeCount, so if the count arrives later (or never — the view passes it as a prop, so no
    // event was ever sent), every seek clamps to 0 and the slider silently pins itself at zero. The
    // count is a fact known at construction, so it belongs in input, not an event.
    const actor = createActor(strokePlayerMachine, {
      input: { strokeCount: 9 }
    });
    actor.start();
    expect(actor.getSnapshot().context.strokeCount).toBe(9);
    actor.send({ type: "seek", index: 5 });
    expect(actor.getSnapshot().context.strokeIndex).toBe(5);
  });

  it("rests paused and blank, never autoplaying", () => {
    // WHY: the player must not animate unbidden — the view also honours prefers-reduced-motion, but
    // the machine itself starts at rest with nothing drawn, so the first frame is deterministic.
    const actor = start();
    expect(actor.getSnapshot().value).toBe("paused");
    expect(actor.getSnapshot().context.strokeIndex).toBe(0);
  });

  it("plays from the start, restarting the CSS animation", () => {
    // WHY: play bumps runId, which remounts the SVG — the only way to restart a CSS animation. It
    // also resets the position, so play always means "watch it from stroke 1".
    const actor = start();
    const before = actor.getSnapshot().context.runId;
    actor.send({ type: "play" });
    expect(actor.getSnapshot().value).toBe("playing");
    expect(actor.getSnapshot().context.runId).toBe(before + 1);
    expect(actor.getSnapshot().context.strokeIndex).toBe(0);
  });

  it("pauses without restarting", () => {
    // WHY: pause must hold position (no runId bump) — a pause that secretly restarted would jump
    // the animation back to stroke 1 on resume.
    const actor = start();
    actor.send({ type: "play" });
    const runId = actor.getSnapshot().context.runId;
    actor.send({ type: "pause" });
    expect(actor.getSnapshot().value).toBe("paused");
    expect(actor.getSnapshot().context.runId).toBe(runId);
  });

  it("replay restarts even while already playing", () => {
    // WHY: replay is the "watch it again" control — mid-playback it must still bump runId to
    // remount and restart, which a plain self-transition would not do.
    const actor = start();
    actor.send({ type: "play" });
    const runId = actor.getSnapshot().context.runId;
    actor.send({ type: "replay" });
    expect(actor.getSnapshot().value).toBe("playing");
    expect(actor.getSnapshot().context.runId).toBe(runId + 1);
  });

  it("seeks to an absolute position and pauses there", () => {
    // WHY: this is the slider. Dragging it must take over from playback — an animation still
    // advancing under a scrub would fight the user's own input.
    const actor = start();
    actor.send({ type: "play" });
    actor.send({ type: "seek", index: 4 });
    expect(actor.getSnapshot().value).toBe("paused");
    expect(actor.getSnapshot().context.strokeIndex).toBe(4);
  });

  it("clamps a seek to the character's stroke range", () => {
    // WHY: the slider's bounds come from strokeCount, but seek is also reachable from step/stepBack
    // at the extremes. Out-of-range positions would reveal negative or phantom strokes.
    const actor = start(); // 9 strokes
    actor.send({ type: "seek", index: 99 });
    expect(actor.getSnapshot().context.strokeIndex).toBe(9);
    actor.send({ type: "seek", index: -5 });
    expect(actor.getSnapshot().context.strokeIndex).toBe(0);
  });

  it("steps forward and back one stroke at a time, staying in range", () => {
    // WHY: step-through is how you study stroke order — one stroke per press, and it must not run
    // off either end however long the control is held.
    const actor = start(); // 9 strokes
    actor.send({ type: "step" });
    expect(actor.getSnapshot().context.strokeIndex).toBe(1);
    actor.send({ type: "stepBack" });
    expect(actor.getSnapshot().context.strokeIndex).toBe(0);
    actor.send({ type: "stepBack" }); // already at the floor
    expect(actor.getSnapshot().context.strokeIndex).toBe(0);
    for (let i = 0; i < 20; i++) actor.send({ type: "step" });
    expect(actor.getSnapshot().context.strokeIndex).toBe(9); // capped at the ceiling
  });

  it("lands on the complete character when playback finishes", () => {
    // WHY: when the animation ends the character is fully drawn, so the slider must say so. Without
    // this the position would still read 0 (where play started) while all 9 strokes are on screen —
    // and the next `step` would jump the picture back to a single stroke.
    const actor = start();
    actor.send({ type: "play" });
    actor.send({ type: "finished" });
    expect(actor.getSnapshot().value).toBe("paused");
    expect(actor.getSnapshot().context.strokeIndex).toBe(9);
  });

  it("stepping while playing takes over playback", () => {
    // WHY: any manual control wins over the animation. Stepping mid-play must stop the animation at
    // a known position, not leave strokes appearing on their own underneath the user's control.
    const actor = start();
    actor.send({ type: "play" });
    actor.send({ type: "step" });
    expect(actor.getSnapshot().value).toBe("paused");
    expect(actor.getSnapshot().context.strokeIndex).toBe(1);
  });
});
