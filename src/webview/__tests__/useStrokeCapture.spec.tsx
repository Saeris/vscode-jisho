import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStrokeCapture, type Recognize } from "../useStrokeCapture";

type RecognizeMock = ReturnType<typeof vi.fn<Recognize>>;

/**
 * These test the capture logic with NO drawing surface rendered — which is the point of extracting it.
 * The recognizer is injected, so none of this pulls the 6.7MB pattern chunk.
 */
const pointer = (x: number, y: number): React.PointerEvent =>
  ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: { setPointerCapture: vi.fn<(id: number) => void>() }
  }) as unknown as React.PointerEvent;

describe("useStrokeCapture", () => {
  const recognizer = (
    result: string[] = ["日"]
  ): { load: () => Promise<Recognize>; recognize: RecognizeMock } => {
    const recognize: RecognizeMock = vi.fn<Recognize>(() => result);
    return { load: async () => recognize, recognize };
  };

  it("accumulates points into the stroke being drawn", () => {
    // WHY: a move must extend the CURRENT stroke, not start a new one — otherwise a single drawn line
    // arrives at the recognizer as dozens of one-point strokes and nothing matches.
    const { load } = recognizer();
    const { result } = renderHook(() => useStrokeCapture(load));

    act(() => {
      result.current.onPointerDown(pointer(0, 0));
    });
    act(() => {
      result.current.onPointerMove(pointer(5, 5));
      result.current.onPointerMove(pointer(10, 10));
    });

    expect(result.current.strokes).toHaveLength(1);
    expect(result.current.strokes[0]).toHaveLength(3);
  });

  it("ignores movement when no pointer is down", () => {
    // WHY: a pointer crossing the canvas without pressing must not draw. Without the drawing guard,
    // hovering leaves ink.
    const { load } = recognizer();
    const { result } = renderHook(() => useStrokeCapture(load));
    act(() => {
      result.current.onPointerMove(pointer(5, 5));
    });
    expect(result.current.strokes).toHaveLength(0);
  });

  it("recognizes on stroke end, with every point of every stroke", async () => {
    // WHY: this is the bug the ref-as-source-of-truth exists to prevent. Pointer handlers fire faster
    // than React commits, so recognizing from render state loses the tail of the stroke just drawn.
    const { load, recognize } = recognizer(["日", "田"]);
    const { result } = renderHook(() => useStrokeCapture(load));

    act(() => {
      result.current.onPointerDown(pointer(0, 0));
      result.current.onPointerMove(pointer(9, 9));
    });
    await act(async () => {
      await result.current.onPointerUp();
    });
    act(() => {
      result.current.onPointerDown(pointer(20, 0));
      result.current.onPointerMove(pointer(20, 9));
    });
    await act(async () => {
      await result.current.onPointerUp();
    });

    expect(recognize.mock.lastCall?.[0]).toHaveLength(2);
    expect(result.current.candidates).toEqual(["日", "田"]);
  });

  it("does not recognize a pointer-up that follows no stroke", async () => {
    const { load, recognize } = recognizer();
    const { result } = renderHook(() => useStrokeCapture(load));
    await act(async () => {
      await result.current.onPointerUp();
    });
    expect(recognize).not.toHaveBeenCalled();
  });

  it("undo drops the last stroke but keeps the earlier ones", async () => {
    const { load } = recognizer();
    const { result } = renderHook(() => useStrokeCapture(load));
    for (const x of [0, 20]) {
      act(() => {
        result.current.onPointerDown(pointer(x, 0));
      });
      await act(async () => {
        await result.current.onPointerUp();
      });
    }
    expect(result.current.strokes).toHaveLength(2);

    act(() => {
      result.current.undo();
    });
    expect(result.current.strokes).toHaveLength(1);
    // One stroke remains, so its candidates are still meaningful.
    expect(result.current.candidates).not.toEqual([]);
  });

  it("clears candidates when undo empties the canvas", async () => {
    // WHY: candidates describe a drawing that no longer exists. An empty canvas still offering guesses
    // invites the user to pick a character they did not draw.
    const { load } = recognizer();
    const { result } = renderHook(() => useStrokeCapture(load));
    act(() => {
      result.current.onPointerDown(pointer(0, 0));
    });
    await act(async () => {
      await result.current.onPointerUp();
    });
    expect(result.current.candidates).not.toEqual([]);

    act(() => {
      result.current.undo();
    });
    expect(result.current.strokes).toHaveLength(0);
    expect(result.current.candidates).toEqual([]);
    expect(result.current.hasStrokes).toBe(false);
  });

  it("clear resets strokes and candidates together", async () => {
    const { load } = recognizer();
    const { result } = renderHook(() => useStrokeCapture(load));
    act(() => {
      result.current.onPointerDown(pointer(0, 0));
    });
    await act(async () => {
      await result.current.onPointerUp();
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.strokes).toEqual([]);
    expect(result.current.candidates).toEqual([]);
  });
});
