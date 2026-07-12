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
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const current = useRef<Point[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const toLocal = (e: React.PointerEvent): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0)];
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = [toLocal(e)];
    setStrokes((s) => [...s, current.current!]);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!current.current) return;
    current.current.push(toLocal(e));
    // Trigger a re-render by replacing the last stroke reference.
    setStrokes((s) => [...s.slice(0, -1), [...current.current!]]);
  };

  const onPointerUp = async (): Promise<void> => {
    if (!current.current) return;
    current.current = null;
    const recognize = await loadRecognizer();
    setCandidates(recognize(strokes));
  };

  const undo = (): void => {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    if (next.length === 0) setCandidates([]);
  };

  const clear = (): void => {
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
