import { useQuery, useQueryClient } from "@tanstack/react-query";
import { kanjiQuery, strokeSvgQuery } from "../queries";
import { DetailView } from "../components/DetailView";
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
  onOpenKanji: (literal: string) => void;
  onFindByPart: (parts: string[]) => void;
}

/**
 * Stroke order as its own pushed view: the animated player plus the step-by-step chart. Kept off
 * the kanji detail deliberately — that page leads with meaning/readings for translation work, and
 * stroke practice is a destination you opt into (docs/STROKE-ORDER.md).
 */
export const StrokeOrder = ({
  literal,
  onBack,
  onHome,
  onOpenKanji,
  onFindByPart
}: StrokeOrderProps): React.ReactElement => {
  const query = useQuery(strokeSvgQuery(literal));
  const queryClient = useQueryClient();

  // A part is a kanji in its own right (頁) or a radical-only shape (⻌). Route by which detail
  // page can actually exist — a Kanjidic entry wins; otherwise preselect it in the radical picker.
  const openPart = async (part: string): Promise<void> => {
    const kanji = await queryClient.fetchQuery(kanjiQuery(part));
    if (kanji !== null) onOpenKanji(part);
    else onFindByPart([part]);
  };

  return (
    <DetailView
      query={query}
      onBack={onBack}
      onHome={onHome}
      // Not every character in the dictionary has an AnimCJK drawing (rare/variant forms).
      empty="No stroke-order drawing is available for this character."
      above={
        <h1 className={styles.literal} lang="ja">
          {literal}
        </h1>
      }
    >
      {(svg) => (
        <StrokeBody
          svg={svg}
          literal={literal}
          onOpenPart={(part) => void openPart(part)}
        />
      )}
    </DetailView>
  );
};

const StrokeBody = ({
  svg,
  literal,
  onOpenPart
}: {
  svg: string;
  literal: string;
  onOpenPart: (literal: string) => void;
}): React.ReactElement => {
  const strokeCount = countStrokes(svg);
  return (
    <>
      <StrokePlayer
        svg={svg}
        strokeCount={strokeCount}
        onOpenPart={onOpenPart}
      />
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
