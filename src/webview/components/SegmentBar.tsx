import { Button } from "react-aria-components";
import type { SegmentDto } from "../../shared/messages";
import styles from "./SegmentBar.module.css";

interface SegmentBarProps {
  segments: SegmentDto[];
  /** Search for a segment's dictionary form (tapping a content chip). */
  onSelectSegment: (lemma: string) => void;
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
 * POS-colored chip that re-searches its dictionary form; particles and auxiliaries render inert.
 * Colours come from the part-of-speech palette (src/shared/posPalette.ts) and follow the user's
 * chosen variant plus the editor's light/dark theme.
 */
export const SegmentBar = ({
  segments,
  onSelectSegment
}: SegmentBarProps): React.ReactElement => (
  <div className={styles.bar} lang="ja">
    {segments.map((seg, i) =>
      isContent(seg.pos) ? (
        <Button
          key={i}
          className={styles.chip}
          data-pos={seg.pos}
          onPress={() => onSelectSegment(seg.lemma)}
          aria-label={`Search ${seg.lemma}`}
        >
          {seg.surface}
        </Button>
      ) : (
        <span key={i} className={styles.particle} data-pos={seg.pos}>
          {seg.surface}
        </span>
      )
    )}
  </div>
);
