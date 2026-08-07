import type { Selection } from "react-aria-components";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import type { SegmentDto } from "../../shared/messages";
import styles from "./SegmentBar.module.css";

interface SegmentBarProps {
  segments: SegmentDto[];
  /** Index of the chip currently filtering the results, or null when the whole sentence shows. */
  selected: number | null;
  /** Filter the results to one segment, or `null` to clear (#16). */
  onSelectSegment: (index: number | null) => void;
}

/**
 * Whether a segment is a searchable content word. Particles and auxiliaries are grammar, not
 * vocabulary — searching them lands on a function-word entry nobody wanted — so they render as
 * static text. They are still COLOURED (see the CSS): being uncoloured would make them ambiguous
 * with categories that desaturate toward grey under dichromacy.
 */
const isContent = (pos: SegmentDto["pos"]): boolean =>
  pos !== "particle" && pos !== "auxiliary" && pos !== "other";

/**
 * The morphological breakdown of a multi-word query (jisho.org-style): each content word is a
 * POS-colored chip, and tapping one FILTERS the results to that word (#16). Particles and
 * auxiliaries render inert. Colours come from the part-of-speech palette (src/shared/posPalette.ts)
 * and follow the user's chosen variant plus the editor's light/dark theme.
 *
 * A filter rather than a re-search: tapping a chip used to overwrite the query with that lemma,
 * which destroyed the sentence and left no way back to the other fragments — chip-to-chip movement
 * was impossible because the chips were gone as soon as you used one. The sentence now stays in the
 * box and the bar stays on screen, so the breakdown is something you can move around inside.
 *
 * `ToggleButtonGroup` in single-selection mode is that behaviour exactly, so the selection is its
 * job rather than ours: it owns `aria-pressed`, emits `data-selected` for the styling, and gives the
 * chips arrow-key navigation as one composite widget. Empty selection is allowed (the default), so
 * tapping the active chip clears the filter — no separate "show everything" control.
 *
 * The key is the segment's INDEX, not its lemma, because a sentence can repeat a word (行って…行く)
 * and those chips must select independently.
 */
export const SegmentBar = ({
  segments,
  selected,
  onSelectSegment
}: SegmentBarProps): React.ReactElement => {
  const handleChange = (keys: Selection): void => {
    // "all" is unreachable in single-selection mode, but the Selection type includes it.
    if (keys === "all") return;
    // Empty when the active chip was tapped again — the group allows an empty selection, and that
    // is what clears the filter.
    if (keys.size === 0) {
      onSelectSegment(null);
      return;
    }
    const [first] = keys;
    onSelectSegment(Number(first));
  };

  return (
    <ToggleButtonGroup
      className={styles.bar}
      lang="ja"
      selectionMode="single"
      selectedKeys={selected === null ? [] : [String(selected)]}
      onSelectionChange={handleChange}
      aria-label="Filter results by word"
    >
      {segments.map((seg, i) =>
        isContent(seg.pos) ? (
          <ToggleButton
            key={i}
            id={String(i)}
            className={styles.chip}
            data-pos={seg.pos}
            aria-label={`Filter results to ${seg.lemma}`}
          >
            {seg.surface}
          </ToggleButton>
        ) : (
          <span key={i} className={styles.particle} data-pos={seg.pos}>
            {seg.surface}
          </span>
        )
      )}
    </ToggleButtonGroup>
  );
};
