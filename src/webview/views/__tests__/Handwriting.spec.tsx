import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithNavigation } from "../../__tests__/navigationHarness";
import { Handwriting } from "../Handwriting";
import type { Pattern, RefPattern } from "../../recognizer/types";
import type { KanjiResultDto } from "../../../shared/messages";
import type { NavEvent } from "../../machines/navigation";

// The meanings the view now fetches for its candidates. Only 日 is present, deliberately: a
// candidate whose literal the host does not return must still render, because the recognizer's
// characters arrive instantly and the labels do not.
const previews: KanjiResultDto[] = [
  {
    literal: "日",
    strokeCount: 4,
    grade: 1,
    jlpt: 5,
    meaningPreview: "day, sun, Japan",
    onPreview: "ニチ、ジツ",
    kunPreview: "ひ、-び"
  }
];

vi.mock("../../queries", () => ({
  kanjiPreviewsQuery: (literals: string[]) => ({
    queryKey: ["kanjiPreviews", literals.join("")],
    queryFn: () => previews.filter((p) => literals.includes(p.literal))
  })
}));

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

/**
 * Render inside a query client as well as the navigation provider.
 *
 * The view fetches its candidates' meanings, so a bare navigation render now throws "No QueryClient
 * set". Wrapped here rather than at each call site so the specs below read unchanged.
 */
const render = (ui: ReactElement): { sent: NavEvent[] } => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  return renderWithNavigation(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
};

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
  it("shows the hint before anything is drawn", () => {
    render(<Handwriting />);
    expect(screen.getByText(/draw a kanji/i)).toBeDefined();
  });

  it("recognizes ALL committed strokes, not a stale subset (regression: え crash)", async () => {
    // WHY: the original bug recognized the *previous* render's strokes (stale closure), so a second
    // stroke was dropped. Draw two strokes and assert recognize saw both — the exact wiring failure.
    render(<Handwriting />);
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

  it("renders candidate chips and appends the chosen character to the search", async () => {
    // Picking a candidate now dispatches through navigation rather than calling a prop, so the
    // assertion is on the event: append the character AND return to search, which is the flow the
    // view exists for (Shirabe's draw → pick → search).
    const { sent } = render(<Handwriting />);
    drawStroke(getCanvas(), [
      [10, 10],
      [40, 40]
    ]);
    const chip = await screen.findByRole("button", { name: "日" });
    fireEvent.click(chip);
    expect(sent).toContainEqual({ type: "appendToSearch", char: "日" });
  });

  it("clear removes strokes and candidates", async () => {
    render(<Handwriting />);
    drawStroke(getCanvas(), [
      [10, 10],
      [40, 40]
    ]);
    await screen.findByRole("button", { name: "日" });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.queryByRole("button", { name: "日" })).toBeNull();
    expect(screen.getByText(/draw a kanji/i)).toBeDefined();
  });

  it("labels a candidate with its meaning once the host answers", async () => {
    // WHY: the recognizer emits bare characters, so a drawn 日/曰/白 was three near-identical glyphs
    // with no way to tell which one you wanted without opening each. The meaning is the whole point
    // of the round trip — asserting it is VISIBLE (not merely in the aria-label) is what makes this
    // test fail if the label is fetched but never rendered.
    render(<Handwriting />);
    drawStroke(getCanvas(), [
      [10, 10],
      [40, 40]
    ]);
    await expect(screen.findByText("day, sun, Japan")).resolves.toBeDefined();
  });

  it("still shows a candidate the host has no meaning for", async () => {
    // WHY: the characters are local and instant, the meanings are not. If a tile waited for its
    // label — or dropped out when the host returned nothing for it — a slow or partial response
    // would cost the user the candidate itself, which is the one thing this view must always give.
    // 曰 and 白 are absent from the fixture, so they exercise exactly that path.
    render(<Handwriting />);
    drawStroke(getCanvas(), [
      [10, 10],
      [40, 40]
    ]);
    await expect(
      screen.findByRole("button", { name: "白" })
    ).resolves.toBeDefined();
  });

  it("undo removes the last stroke", async () => {
    render(<Handwriting />);
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
