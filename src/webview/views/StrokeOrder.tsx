import { useQuery, useQueryClient } from "@tanstack/react-query";
import { kanjiQuery, strokeSvgQuery } from "../queries";
import { DetailView } from "../components/DetailView";
import { StrokeChart } from "../components/StrokeChart";
import { StrokePlayer } from "../components/StrokePlayer";
import styles from "./StrokeOrder.module.css";

/**
 * How many strokes the drawing has.
 *
 * Counts DISTINCT stroke ordinals, not paths. They were the same thing until kana arrived: a
 * self-crossing kana stroke is painted as two clipped fragments sharing one `--stroke` (あ's third
 * is `c3a` + `c3b`), so counting paths reports あ as 4 strokes and the chart renders a fourth step
 * identical to the third.
 */
const countStrokes = (svg: string): number =>
  new Set([...svg.matchAll(/--stroke:(\d+)/g)].map((match) => match[1])).size;

interface StrokeOrderProps {
  literal: string;
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
