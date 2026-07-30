import { Button } from "react-aria-components";
import { getStroke } from "perfect-freehand";
import { DetailHeader } from "../components/DetailHeader";
import { useNavigate } from "../navigation";
import type { Point } from "../recognizer/types";
import { useStrokeCapture } from "../useStrokeCapture";
import styles from "./Handwriting.module.css";

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

/**
 * Draw-to-search handwriting. Captures pointer strokes (rendered with perfect-freehand), and on each
 * stroke end runs the (lazily-loaded) recognizer to show candidate kanji as chips — tapping one
 * appends it to the search query and returns to search, mirroring Shirabe's flow. Stroke order and
 * count don't matter (the recognizer is free of both).
 */
export const Handwriting = (): React.ReactElement => {
  const { back, appendToSearch } = useNavigate();
  const {
    strokes,
    candidates,
    surface,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    undo,
    clear,
    hasStrokes
  } = useStrokeCapture();

  return (
    <div className={styles.container}>
      <DetailHeader onBack={back} />
      <div className={styles.body}>
        <svg
          ref={surface}
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
            isDisabled={!hasStrokes}
          >
            Undo
          </Button>
          <Button
            className={styles.control}
            onPress={clear}
            isDisabled={!hasStrokes}
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
                onPress={() => appendToSearch(char)}
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
