import styles from "./StrokeChart.module.css";

/**
 * The stroke-order chart: a grid where cell N shows the character drawn up to its Nth stroke — the
 * classic textbook/Shirabe reference layout.
 *
 * Each cell is the same SVG seeked to a different position, reusing the trick documented in
 * StrokePlayer.module.css: a negative `animation-delay` scrubs the whole timeline, so `--stroke-index`
 * decides how much is drawn. No per-cell data and no JS — just N copies at N offsets.
 *
 * The newest stroke in each cell is highlighted against the strokes already laid down, which is the
 * chart's whole point: you read *which* stroke is added at each step, not just the running total.
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

/**
 * `--stroke-index` seeks this cell's copy of the animation; `--highlight-stroke` tells the CSS which
 * stroke is the new one. See StrokePlayer.tsx's strokeVars for why this needs the intersection type.
 */
const cellVars = (
  step: number
): React.CSSProperties &
  Record<"--stroke-index" | "--highlight-stroke", number> => ({
  "--stroke-index": step,
  "--highlight-stroke": step
});
