import { useQuery } from "@tanstack/react-query";
import { strokeSvgQuery } from "../queries";
import { DetailHeader } from "../components/DetailHeader";
import { StrokeChart } from "../components/StrokeChart";
import { StrokePlayer } from "../components/StrokePlayer";
import styles from "./StrokeOrder.module.css";

/** Count strokes in the SVG markup: each animated stroke is a `clip-path`'d path (AnimCJK shape). */
const countStrokes = (svg: string): number =>
  (svg.match(/clip-path=/g) ?? []).length;

interface StrokeOrderProps {
  literal: string;
  onBack: () => void;
  onHome?: () => void;
}

/**
 * Stroke order as its own pushed view: the animated player, plus the full step-by-step chart.
 *
 * Deliberately NOT inline on the kanji detail. This extension's primary use is translating and
 * authoring prose in the editor next door, so the detail page leads with meaning, readings, and
 * copy-to-clipboard; stroke practice is a destination you opt into. (Shirabe, an educational aid,
 * puts the chart up front — a reasonable choice for a different job.) The sub-page also gives the
 * chart room to breathe, which a narrow sidebar can't spare inline.
 */
export const StrokeOrder = ({
  literal,
  onBack,
  onHome
}: StrokeOrderProps): React.ReactElement => {
  const { data: svg, isPending, isError } = useQuery(strokeSvgQuery(literal));

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack} onHome={onHome} />
      <div className={styles.body}>
        <h1 className={styles.literal} lang="ja">
          {literal}
        </h1>
        {isPending ? (
          <p className={styles.status}>Loading strokes…</p>
        ) : isError ? (
          <p className={styles.status}>Failed to load stroke data.</p>
        ) : svg === null ? (
          // Not every character in the dictionary has an AnimCJK drawing (rare/variant forms).
          <p className={styles.status}>
            No stroke-order drawing is available for this character.
          </p>
        ) : (
          <StrokeBody svg={svg} literal={literal} />
        )}
      </div>
    </div>
  );
};

const StrokeBody = ({
  svg,
  literal
}: {
  svg: string;
  literal: string;
}): React.ReactElement => {
  const strokeCount = countStrokes(svg);
  return (
    <>
      <StrokePlayer svg={svg} strokeCount={strokeCount} />
      <section className={styles.section}>
        <h2 className={styles.heading}>
          Chart
          <span className={styles.count}>{strokeCount} strokes</span>
        </h2>
        <StrokeChart svg={svg} strokeCount={strokeCount} literal={literal} />
      </section>
    </>
  );
};
