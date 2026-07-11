import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { strokePlayerMachine } from "../machines/strokePlayer";

const start = (): ReturnType<
  typeof createActor<typeof strokePlayerMachine>
> => {
  const actor = createActor(strokePlayerMachine);
  actor.start();
  actor.send({ type: "load", strokeCount: 9 });
  return actor;
};

describe("strokePlayerMachine", () => {
  it("starts idle and plays from the start", () => {
    // WHY: the player must not autoplay (respects reduced-motion at the view layer); it begins idle
    // and only animates on an explicit play, bumping runId to (re)start the CSS animation.
    const actor = start();
    expect(actor.getSnapshot().value).toBe("idle");
    const before = actor.getSnapshot().context.runId;
    actor.send({ type: "play" });
    expect(actor.getSnapshot().value).toBe("playing");
    expect(actor.getSnapshot().context.runId).toBe(before + 1);
  });

  it("toggles between playing and paused without restarting", () => {
    // WHY: pause/resume must hold position (no runId bump) — only replay restarts. A pause that
    // secretly restarted would jump the animation back to stroke 1.
    const actor = start();
    actor.send({ type: "play" });
    const runId = actor.getSnapshot().context.runId;
    actor.send({ type: "pause" });
    expect(actor.getSnapshot().value).toBe("paused");
    actor.send({ type: "play" });
    expect(actor.getSnapshot().value).toBe("playing");
    expect(actor.getSnapshot().context.runId).toBe(runId); // resumed, not restarted
  });

  it("replay always restarts the animation", () => {
    // WHY: replay is the "watch it again" control — it must bump runId to remount/restart the SVG
    // regardless of current state.
    const actor = start();
    actor.send({ type: "play" });
    const runId = actor.getSnapshot().context.runId;
    actor.send({ type: "replay" });
    expect(actor.getSnapshot().value).toBe("playing");
    expect(actor.getSnapshot().context.runId).toBe(runId + 1);
  });

  it("steps one stroke at a time, capped at the stroke count", () => {
    // WHY: step-through reveals strokes incrementally for study; it must advance by exactly one and
    // never exceed the character's stroke count.
    const actor = start(); // 9 strokes
    actor.send({ type: "step" });
    expect(actor.getSnapshot().value).toBe("stepped");
    expect(actor.getSnapshot().context.steppedTo).toBe(1);
    for (let i = 0; i < 20; i++) actor.send({ type: "step" });
    expect(actor.getSnapshot().context.steppedTo).toBe(9); // capped
  });

  it("playing after stepping restarts a clean run", () => {
    // WHY: leaving stepped mode via play should re-animate from the start (runId bump, steppedTo
    // cleared) rather than resume from a partial stepped state.
    const actor = start();
    actor.send({ type: "step" });
    actor.send({ type: "step" });
    const runId = actor.getSnapshot().context.runId;
    actor.send({ type: "play" });
    expect(actor.getSnapshot().value).toBe("playing");
    expect(actor.getSnapshot().context.runId).toBe(runId + 1);
    expect(actor.getSnapshot().context.steppedTo).toBeNull();
  });
});
