// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Handwriting } from "../Handwriting";
import type { Pattern, RefPattern } from "../../recognizer/types";

// The recognizer + its patterns are lazy-imported; mock them so the component test is fast and
// deterministic. We assert the component's WIRING (pointer → strokes → recognize call → chips →
// callback), not recognition itself (that's the recognizer's own unit suite). The mock captures
// the strokes recognize() was called with — which is exactly what the stale-closure bug corrupted.
const recognizeMock = vi.fn<(strokes: Pattern, limit?: number) => string[]>(
  () => ["日", "曰", "白"]
);
vi.mock("../../recognizer/index", () => ({
  recognize: (strokes: Pattern, _p: readonly RefPattern[], limit?: number) =>
    recognizeMock(strokes, limit)
}));
vi.mock("../../recognizer/patterns", () => ({ refPatterns: [] }));

/** Draw a stroke as a down → moves → up sequence on the canvas. */
const drawStroke = (canvas: Element, points: [number, number][]): void => {
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    clientX: points[0][0],
    clientY: points[0][1]
  });
  for (const [x, y] of points.slice(1)) {
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: x, clientY: y });
  }
  fireEvent.pointerUp(canvas, { pointerId: 1 });
};

const getCanvas = (): Element => {
  const svg = document.querySelector("svg");
  if (svg === null) throw new Error("no drawing canvas");
  return svg;
};

describe("handwriting view", () => {
  beforeAll(() => {
    // jsdom doesn't implement pointer capture; stub it so the handlers don't throw.
    Element.prototype.setPointerCapture = (): void => {};
    Element.prototype.releasePointerCapture = (): void => {};
  });

  afterEach(() => {
    cleanup();
    recognizeMock.mockClear();
  });

  it("shows the hint before anything is drawn", () => {
    render(<Handwriting onBack={() => {}} onPick={() => {}} />);
    expect(screen.getByText(/draw a kanji/i)).toBeDefined();
  });

  it("recognizes ALL committed strokes, not a stale subset (regression: え crash)", async () => {
    // WHY: the original bug recognized the *previous* render's strokes (stale closure), so a second
    // stroke was dropped. Draw two strokes and assert recognize saw both — the exact wiring failure.
    render(<Handwriting onBack={() => {}} onPick={() => {}} />);
    const canvas = getCanvas();
    drawStroke(canvas, [
      [10, 10],
      [40, 40]
    ]);
    drawStroke(canvas, [
      [50, 10],
      [80, 40]
    ]);
    // Recognition runs on pointer-up (after the lazy import resolves); wait for the chips it drives.
    await screen.findByRole("button", { name: "日" });
    const lastStrokes = recognizeMock.mock.lastCall?.[0];
    expect(lastStrokes).toHaveLength(2); // both strokes present, not one
  });

  it("renders candidate chips and calls onPick with the chosen character", async () => {
    const onPick = vi.fn<(char: string) => void>();
    render(<Handwriting onBack={() => {}} onPick={onPick} />);
    drawStroke(getCanvas(), [
      [10, 10],
      [40, 40]
    ]);
    const chip = await screen.findByRole("button", { name: "日" });
    fireEvent.click(chip);
    expect(onPick).toHaveBeenCalledWith("日");
  });

  it("clear removes strokes and candidates", async () => {
    render(<Handwriting onBack={() => {}} onPick={() => {}} />);
    drawStroke(getCanvas(), [
      [10, 10],
      [40, 40]
    ]);
    await screen.findByRole("button", { name: "日" });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.queryByRole("button", { name: "日" })).toBeNull();
    expect(screen.getByText(/draw a kanji/i)).toBeDefined();
  });

  it("undo removes the last stroke", async () => {
    render(<Handwriting onBack={() => {}} onPick={() => {}} />);
    const canvas = getCanvas();
    drawStroke(canvas, [
      [10, 10],
      [40, 40]
    ]);
    drawStroke(canvas, [
      [50, 10],
      [80, 40]
    ]);
    await screen.findByRole("button", { name: "日" });
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(document.querySelectorAll("svg path")).toHaveLength(1);
  });
});
