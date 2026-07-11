import { Button } from "react-aria-components";
import type { SegmentDto } from "../../shared/messages";
import styles from "./SegmentBar.module.css";

interface SegmentBarProps {
  segments: SegmentDto[];
  /** Search for a segment's dictionary form (tapping a content chip). */
  onSelectSegment: (lemma: string) => void;
}

const isContent = (pos: SegmentDto["pos"]): boolean =>
  pos !== "particle" && pos !== "auxiliary" && pos !== "other";

/**
 * The morphological breakdown of a multi-word query (jisho.org-style): each content word is a
 * POS-colored chip that re-searches its dictionary form; particles/auxiliaries render dimmed and
 * inert. Colors derive from VSCode's chart palette so they track the active theme.
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
        <span key={i} className={styles.particle}>
          {seg.surface}
        </span>
      )
    )}
  </div>
);
