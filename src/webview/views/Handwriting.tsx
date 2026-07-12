import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import { getStroke } from "perfect-freehand";
import { DetailHeader } from "../components/DetailHeader";
import type { Point, Stroke } from "../recognizer/types";
import styles from "./Handwriting.module.css";

interface HandwritingProps {
  onBack: () => void;
  /** Append the chosen character to the search query and return to search. */
  onPick: (char: string) => void;
}

/** Turn a raw stroke's points into a closed SVG path via perfect-freehand's variable-width outline. */
const strokeToPath = (points: readonly Point[]): string => {
  const outline = getStroke(
    points.map((p) => [p[0], p[1]]),
    { size: 14, thinning: 0.6, smoothing: 0.5, streamline: 0.5 }
  );
  if (outline.length === 0) return "";
  const parts: string[] = [`M ${outline[0][0]} ${outline[0][1]} Q`];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    parts.push(`${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`);
  }
  return `${parts.join(" ")} Z`;
};

// The recognizer + its 6.7MB reference patterns are loaded on demand (dynamic import) the first time
// a stroke is completed, so the base webview bundle stays small — the chunk downloads only when the
// handwriting view is actually used.
type Recognize = (strokes: Stroke[], limit?: number) => string[];
let recognizerPromise: Promise<Recognize> | undefined;
const loadRecognizer = async (): Promise<Recognize> => {
  recognizerPromise ??= (async (): Promise<Recognize> => {
    const [{ recognize }, { refPatterns }] = await Promise.all([
      import("../recognizer/index"),
      import("../recognizer/patterns")
    ]);
    return (strokes, limit = 8) => recognize(strokes, refPatterns, limit);
  })();
  return recognizerPromise;
};

/**
 * Draw-to-search handwriting. Captures pointer strokes (rendered with perfect-freehand), and on each
 * stroke end runs the (lazily-loaded) recognizer to show candidate kanji as chips — tapping one
 * appends it to the search query and returns to search, mirroring Shirabe's flow. Stroke order and
 * count don't matter (the recognizer is free of both).
 */
export const Handwriting = ({
  onBack,
  onPick
}: HandwritingProps): React.ReactElement => {
  // The stroke data lives in a ref (the source of truth, always current in event handlers — no
  // stale-closure races); `strokes` state is a render mirror bumped after each mutation.
  const strokesRef = useRef<Point[][]>([]);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const drawing = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const sync = (): void => setStrokes(strokesRef.current.map((s) => [...s]));

  const toLocal = (e: React.PointerEvent): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0)];
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokesRef.current.push([toLocal(e)]);
    sync();
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drawing.current) return;
    strokesRef.current[strokesRef.current.length - 1].push(toLocal(e));
    sync();
  };

  const onPointerUp = async (): Promise<void> => {
    if (!drawing.current) return;
    drawing.current = false;
    const recognize = await loadRecognizer();
    // Recognize the current committed strokes (from the ref, not a stale render closure).
    setCandidates(recognize(strokesRef.current));
  };

  const undo = (): void => {
    strokesRef.current.pop();
    sync();
    if (strokesRef.current.length === 0) setCandidates([]);
  };

  const clear = (): void => {
    strokesRef.current = [];
    setStrokes([]);
    setCandidates([]);
  };

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack} />
      <div className={styles.body}>
        <svg
          ref={svgRef}
          className={styles.canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => void onPointerUp()}
        >
          {strokes.map((points, i) => (
            <path key={i} className={styles.ink} d={strokeToPath(points)} />
          ))}
        </svg>

        <div className={styles.controls}>
          <Button
            className={styles.control}
            onPress={undo}
            isDisabled={strokes.length === 0}
          >
            Undo
          </Button>
          <Button
            className={styles.control}
            onPress={clear}
            isDisabled={strokes.length === 0}
          >
            Clear
          </Button>
        </div>

        {candidates.length > 0 ? (
          <div className={styles.candidates}>
            {candidates.map((char) => (
              <Button
                key={char}
                className={styles.candidate}
                onPress={() => onPick(char)}
                lang="ja"
              >
                {char}
              </Button>
            ))}
          </div>
        ) : (
          <p className={styles.hint}>
            Draw a kanji above — stroke order and count don&apos;t matter.
          </p>
        )}
      </div>
    </div>
  );
};
