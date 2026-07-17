import styles from "./StrokeChart.module.css";

/**
 * Stroke-order chart: cell N shows the character drawn to its Nth stroke, newest stroke
 * highlighted — the classic textbook layout. Each cell injects the same SVG with `--stroke-index`
 * set to its own number; the stylesheet does the rest. See docs/STROKE-ORDER.md.
 */
export const StrokeChart = ({
  svg,
  strokeCount,
  literal
}: {
  svg: string;
  strokeCount: number;
  literal: string;
}): React.ReactElement => (
  <ol className={styles.chart} aria-label={`Stroke order chart for ${literal}`}>
    {Array.from({ length: strokeCount }, (_, i) => i + 1).map((step) => (
      <li key={step} className={styles.cell}>
        <span className={styles.step} aria-hidden="true">
          {step}
        </span>
        <div
          className={styles.canvas}
          style={cellVars(step)}
          aria-label={`Stroke ${step} of ${strokeCount}`}
          // Our own build output (assets/kanji-svgs), not user input — safe to inject.
          // oxlint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </li>
    ))}
  </ol>
);

// React's CSSProperties has no index signature for --* names; the intersection states the extra
// key honestly, no cast needed.
const cellVars = (
  step: number
): React.CSSProperties & Record<"--stroke-index", number> => ({
  "--stroke-index": step
});
