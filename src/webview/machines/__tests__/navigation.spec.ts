import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import { activeView, canGoBack, navigationMachine } from "../navigation";

describe("navigationMachine", () => {
  it("starts on the search view with no back available", () => {
    // WHY: search is the app's entry point and the floor of the stack — the user must never be
    // able to navigate "back" out of it into an empty screen.
    const actor = createActor(navigationMachine).start();
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });

  it("opening a word pushes a detail view and enables back", () => {
    // WHY: tapping a result must navigate *forward* to that word (preserving search beneath), which
    // is what makes returning to the same result list possible.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1358280" });
    const ctx = actor.getSnapshot().context;
    expect(activeView(ctx)).toEqual({ name: "wordDetail", id: "1358280" });
    expect(canGoBack(ctx)).toBe(true);
  });

  it("back from a detail view restores the search view", () => {
    // WHY: the core navigation loop is search → word → back-to-search; if back didn't restore the
    // prior view the user would lose their results on every lookup.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1358280" });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });

  it("back at the base search view is a no-op (cannot pop the floor)", () => {
    // WHY: a stray back event (e.g. keyboard) at the root must not empty the stack and crash render.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
  });

  it("supports a stack of multiple detail views", () => {
    // WHY: following a cross-reference from one word to another builds depth; back must unwind one
    // level at a time, not jump straight home.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "a" });
    actor.send({ type: "openWord", id: "b" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "b"
    });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "a"
    });
  });

  it("preserves the search query across openWord → back", () => {
    // WHY: returning from a word detail must restore the user's search, not dump them on an
    // empty view — the query lives in machine context precisely so it survives the view switch.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "setSearchQuery", query: "たべる" });
    actor.send({ type: "openWord", id: "1358280" });
    actor.send({ type: "back" });
    expect(actor.getSnapshot().context.searchQuery).toBe("たべる");
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
  });

  it("searchFor jumps to the search view with the new query", () => {
    // WHY: tapping a cross-reference in a word detail must land the user on the search view
    // showing results for that term — this is the tap-through action's whole contract.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "setSearchQuery", query: "eat" });
    actor.send({ type: "openWord", id: "1358280" });
    actor.send({ type: "searchFor", term: "食う" });
    const ctx = actor.getSnapshot().context;
    expect(activeView(ctx)).toEqual({ name: "search" });
    expect(ctx.searchQuery).toBe("食う");
  });

  it("home resets the stack to just search", () => {
    // WHY: a "home" affordance must collapse arbitrary depth back to the search floor in one step.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "a" });
    actor.send({ type: "openWord", id: "b" });
    actor.send({ type: "home" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });
});
