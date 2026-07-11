import { pitchContour } from "../pitch";
import styles from "./PitchAccent.module.css";

/**
 * Graphical pitch-accent contour over a reading (Shirabe/OJAD style): high-pitch moras carry a top
 * overline, and the downstep is drawn as a drop after the accent mora. Strictly more legible than a
 * bare number, which is kept in the title for reference. When a reading has multiple accepted
 * patterns, we render the first (most common) as the contour and note the rest in the title.
 *
 * Renders nothing when no accent data is known.
 */
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
  const title =
    accents.length > 1
      ? `Pitch accent ${accents.join("・")} (downstep mora; 0 = flat)`
      : `Pitch accent ${primary} (downstep mora; 0 = flat)`;

  return (
    <span className={styles.contour} title={title} aria-label={title} lang="ja">
      {contour.map((m, i) => (
        <span
          key={i}
          className={[
            styles.mora,
            m.high ? styles.high : styles.low,
            m.drop ? styles.drop : ""
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {m.mora}
        </span>
      ))}
    </span>
  );
};
