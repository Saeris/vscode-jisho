import { useRef, useState } from "react";
import type { Point, Stroke } from "./recognizer/types";

/** Recognize a set of drawn strokes, best candidates first. */
export type Recognize = (strokes: Stroke[], limit?: number) => string[];

/**
 * The recognizer and its 6.7MB reference patterns load on demand, the first time a stroke is
 * completed, so the base webview bundle stays small — the chunk downloads only when someone actually
 * draws. Cached at module scope, so it is fetched once per session rather than per mount.
 */
let recognizerPromise: Promise<Recognize> | undefined;
const loadRecognizerChunk = async (): Promise<Recognize> => {
  recognizerPromise ??= (async (): Promise<Recognize> => {
    const [{ recognize }, { refPatterns }] = await Promise.all([
      import("./recognizer/index"),
      import("./recognizer/patterns")
    ]);
    return (strokes, limit = 8) => recognize(strokes, refPatterns, limit);
  })();
  return recognizerPromise;
};

export interface StrokeCapture {
  /** Committed strokes, for rendering. A new array each mutation so React sees the change. */
  strokes: Point[][];
  /** Recognizer output for the strokes drawn so far; empty until the first stroke ends. */
  candidates: string[];
  /** Attach to the drawing surface — pointer coordinates are measured relative to it. */
  surface: React.RefObject<SVGSVGElement | null>;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => Promise<void>;
  undo: () => void;
  clear: () => void;
  /** Whether there is anything to undo or clear — drives the controls' disabled state. */
  hasStrokes: boolean;
}

/**
 * Pointer-stroke capture with on-demand recognition, extracted from the Handwriting view.
 *
 * Separated from rendering because it is the part with behaviour worth testing — where strokes
 * accumulate, when recognition runs, and what undo does to the candidate list — none of which needs
 * an SVG on screen to verify.
 *
 * `loadRecognizer` is injectable for exactly that reason: the real one pulls a 6.7MB chunk, so a test
 * that wanted to assert "recognition runs when a stroke ends" would otherwise have to load it.
 *
 * The stroke data lives in a REF as the source of truth, with `strokes` state as a render mirror.
 * Pointer handlers fire faster than React commits, so reading state inside them would race — a move
 * event would append to the array a previous render closed over and lose points.
 */
export const useStrokeCapture = (
  loadRecognizer: () => Promise<Recognize> = loadRecognizerChunk
): StrokeCapture => {
  const strokesRef = useRef<Point[][]>([]);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const drawing = useRef(false);
  const surface = useRef<SVGSVGElement>(null);

  const sync = (): void => setStrokes(strokesRef.current.map((s) => [...s]));

  const toLocal = (event: React.PointerEvent): Point => {
    const rect = surface.current?.getBoundingClientRect();
    return [
      event.clientX - (rect?.left ?? 0),
      event.clientY - (rect?.top ?? 0)
    ];
  };

  return {
    strokes,
    candidates,
    surface,
    hasStrokes: strokes.length > 0,

    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      drawing.current = true;
      strokesRef.current.push([toLocal(event)]);
      sync();
    },

    onPointerMove: (event) => {
      if (!drawing.current) return;
      strokesRef.current[strokesRef.current.length - 1].push(toLocal(event));
      sync();
    },

    onPointerUp: async () => {
      if (!drawing.current) return;
      drawing.current = false;
      const recognize = await loadRecognizer();
      // From the ref, not a render closure: the last points of the stroke may not have committed yet.
      setCandidates(recognize(strokesRef.current));
    },

    undo: () => {
      strokesRef.current.pop();
      sync();
      // Candidates described a drawing that no longer exists; an empty canvas must not keep offering
      // guesses from strokes the user removed.
      if (strokesRef.current.length === 0) setCandidates([]);
    },

    clear: () => {
      strokesRef.current = [];
      setStrokes([]);
      setCandidates([]);
    }
  };
};
