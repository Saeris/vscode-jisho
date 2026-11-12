import { useRef } from "react";
import {
  COLUMN_LANGS,
  columnNames,
  inkOf,
  type FormRow
} from "../regionalForms";
import styles from "./Overprint.module.css";

/** How far a press-and-drag can pull the layers apart, per layer. */
const MAX_PULL = 28;

/**
 * Fill fades as strokes rise (hanji's values), so a complex stack does not turn into a dark block:
 * 0.42 below 10 strokes, down to 0.24 at 20 or more.
 */
const fillFor = (strokes: number): number =>
  strokes < 10
    ? 0.42
    : strokes >= 20
      ? 0.24
      : 0.42 - ((strokes - 10) / 10) * 0.18;

interface OverprintProps {
  /** The distinct forms, Japan's first (`formRows`). */
  rows: FormRow[];
  /** `stack` overlays the forms; `separate` sets them side by side, labelled. */
  mode?: "stack" | "separate";
  /** Outlines only: reads better than fills on a dense character. */
  outline?: boolean;
  /** The large, interactive stack of the Regional forms view, the kanji page's small one, or a list row's. */
  size?: "large" | "small" | "row";
  /** Unique on the page: names the layers for the view transition between the two modes. */
  name: string;
}

/**
 * Each distinct form of a character drawn in its region's font, at the same size and place, in its
 * own ink. Strokes the forms share pile up; strokes only one form has stay in that form's ink.
 *
 * Ported from hanji's overprint (MIT, © Kevin Deng) with its behaviours: resting the pointer fans
 * the layers apart and lights each form in turn, naming it below; pressing and dragging pulls them
 * apart, and they spring back on release. The inks differ only in hue, so colour never carries the
 * meaning alone: the caption names the lit form, the separate mode labels every form, and the
 * chart beside the stack names everything. With reduced motion there is no fan and no spring.
 */
export const Overprint = ({
  rows,
  mode = "stack",
  outline = false,
  size = "large",
  name
}: OverprintProps): React.ReactElement => {
  const drag = useRef<number | null>(null);
  const interactive = size === "large" && mode === "stack";
  const strokes = Math.max(0, ...rows.flatMap((row) => row.strokes));
  const label = rows
    .map((row) => `${row.char} (${columnNames(row.columns)})`)
    .join(", ");

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if (!interactive || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = event.clientX;
    event.currentTarget.dataset["dragging"] = "";
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current === null) return;
    const pull = Math.min(Math.abs(event.clientX - drag.current), MAX_PULL);
    // The script writes only the number; how the layers move, and the spring, live in the CSS.
    event.currentTarget.style.setProperty("--overprint-pull", `${pull}px`);
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current === null) return;
    drag.current = null;
    delete event.currentTarget.dataset["dragging"];
    event.currentTarget.style.setProperty("--overprint-pull", "0px");
  };

  return (
    <figure
      className={styles.overprint}
      data-mode={mode}
      data-size={size}
      data-outline={outline || undefined}
      data-interactive={interactive || undefined}
      style={{
        "--n": rows.length,
        "--fill": fillFor(strokes)
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className={styles.forms}
        role="img"
        aria-label={
          mode === "stack" ? `Overlaid: ${label}` : `Side by side: ${label}`
        }
      >
        {rows.map((row, index) => (
          <span
            key={`${row.char}-${row.columns.join("")}`}
            className={styles.form}
            style={{
              "--i": index,
              "--ink": inkOf(index)
            }}
          >
            <span
              className={styles.glyph}
              lang={COLUMN_LANGS[row.columns[0] ?? 3]}
              style={{
                fontFamily: `"${row.family}"`,
                viewTransitionName: `${name}-${index}`
              }}
            >
              {row.char}
            </span>
            {mode === "separate" ? (
              <span className={styles.regions}>{columnNames(row.columns)}</span>
            ) : null}
          </span>
        ))}
      </div>
      {interactive ? (
        // The highlight cycle's words: the same clock lights the layer and its name. Hidden from
        // assistive technology, which gets the whole list at once from the stack's label.
        <figcaption className={styles.captions} aria-hidden="true">
          {rows.map((row, index) => (
            <span
              key={`${row.char}-${row.columns.join("")}`}
              className={styles.caption}
              style={{ "--i": index }}
            >
              {row.char} · {columnNames(row.columns)}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
};
