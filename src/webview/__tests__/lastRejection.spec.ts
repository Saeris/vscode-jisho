import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLastRejection,
  lastRejection,
  noteRejection
} from "../lastRejection";

describe("unhandled rejection recorder", () => {
  beforeEach(() => {
    clearLastRejection();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remembers nothing until something rejects", () => {
    expect(lastRejection()).toBeUndefined();
  });

  it("records an Error's message", () => {
    noteRejection(new Error("the bridge went away"));
    expect(lastRejection()).toBe("the bridge went away");
  });

  it("keeps the MOST RECENT rejection", () => {
    // WHY: the recorder exists to say what preceded a crash. An older rejection is not that, so a
    // first-wins implementation would attach stale context to every report after the first.
    noteRejection(new Error("first"));
    noteRejection(new Error("second"));
    expect(lastRejection()).toBe("second");
  });

  it("survives a rejection that is not an Error", () => {
    // WHY: a promise can reject with anything, and a recorder that threw while recording would take
    // out the page it was installed to observe.
    noteRejection("just a string");
    expect(lastRejection()).toBe("just a string");
  });
});
