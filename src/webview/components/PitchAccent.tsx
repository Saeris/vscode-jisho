import { pitchContour, type MoraPitch } from "../pitch";
import styles from "./PitchAccent.module.css";

/**
 * Pitch-accent contour (Shirabe/OJAD style): one continuous SVG polyline over the reading — high
 * runs, low runs, a vertical at each pitch change. One polyline, not per-mora borders: the line
 * must span mora boundaries, which per-element edges can't express. Alignment needs no measuring —
 * the moras sit in an N-column grid and the SVG stretches across it with `viewBox="0 0 N 10"` +
 * `preserveAspectRatio="none"`, so mora boundary i is always x = i. Renders nothing without data;
 * multiple accepted patterns render the first and note the rest in the title.
 */

/** Band-local y levels (viewBox is 0..10 tall). Both sit in the strip ABOVE the kana. */
const HIGH_Y = 1.2;
const LOW_Y = 8.8;

/** How far the odaka tail extends past the final mora, in columns. */
const TAIL = 0.35;

/**
 * The track's inline custom properties. React's CSSProperties has no index signature for `--*`
 * names; intersecting it with the custom keys states that honestly (they're additional properties,
 * not a narrowing — so no cast is needed or sound here).
 *
 * `--mora-count` drives `grid-template-columns`, and the explicit columns it creates are what let
 * the SVG span the whole track (`grid-column: 1 / -1`).
 */
const trackVars = (
  moraCount: number
): React.CSSProperties & Record<"--mora-count", number> => ({
  "--mora-count": moraCount
});

/**
 * Odaka: the accent sits on the LAST mora, so its drop is only realised on a FOLLOWING particle. We
 * draw a stub past the end to show that fall — without it, odaka and heiban render identically.
 */
const hasTail = (contour: MoraPitch[]): boolean => {
  // .at(-1) rather than [length - 1]: it's the only form TS types as possibly-undefined, so the
  // empty-contour case is checked rather than assumed away.
  const last = contour.at(-1);
  return last?.drop === true && last.high;
};

/**
 * Build the contour polyline's points. Each mora contributes a horizontal run at its own level, and
 * a level change between consecutive moras inserts a vertical connector (two points sharing an x).
 */
const contourPoints = (contour: MoraPitch[]): string => {
  const y = (high: boolean): number => (high ? HIGH_Y : LOW_Y);
  const points: Array<[number, number]> = [];

  contour.forEach((m, i) => {
    // The horizontal run across this mora's column.
    points.push([i, y(m.high)], [i + 1, y(m.high)]);
    // A level change inserts the vertical: the next point shares x but sits at the new level. The
    // bounds check comes first so the last mora never reads past the end.
    if (i < contour.length - 1) {
      const next = contour[i + 1];
      if (next.high !== m.high) points.push([i + 1, y(next.high)]);
    }
  });

  if (hasTail(contour)) {
    points.push([contour.length, LOW_Y], [contour.length + TAIL, LOW_Y]);
  }

  return points.map(([x, py]) => `${x},${py}`).join(" ");
};

export const PitchAccent = ({
  reading,
  accents
}: {
  reading: string;
  accents: number[];
}): React.ReactElement | null => {
  if (accents.length === 0) return null;
  const primary = accents[0];
  const contour = pitchContour(reading, primary);
  if (contour.length === 0) return null;

  const title =
    accents.length > 1
      ? `Pitch accent ${accents.join("・")} (downstep mora; 0 = flat)`
      : `Pitch accent ${primary} (downstep mora; 0 = flat)`;

  // The viewBox must widen to cover the odaka tail, or the stub gets clipped.
  const width = contour.length + (hasTail(contour) ? TAIL : 0);

  return (
    <span className={styles.contour} title={title} aria-label={title} lang="ja">
      <span className={styles.track} style={trackVars(contour.length)}>
        <svg
          className={styles.line}
          viewBox={`0 0 ${width} 10`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={contourPoints(contour)} />
        </svg>
        {contour.map((m, i) => (
          // Explicit column: the SVG spans row 1, so auto-placement would flow the kana around it.
          <span
            key={i}
            className={styles.mora}
            data-mora={m.high ? "high" : "low"}
            style={{ gridColumn: i + 1 } as React.CSSProperties}
          >
            {m.mora}
          </span>
        ))}
      </span>
    </span>
  );
};
