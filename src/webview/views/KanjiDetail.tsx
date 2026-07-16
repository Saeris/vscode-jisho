import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import type { KanjiDetailDto } from "../../shared/messages";
import { kanjiQuery } from "../queries";
import { Badge } from "../components/Badge";
import { CopyButton } from "../components/CopyButton";
import { DetailHeader } from "../components/DetailHeader";
import { SequencePlayButton } from "../components/PlayButton";
import { Term } from "../components/Term";
import { WaniKaniLink } from "../components/WaniKaniLink";
import styles from "./KanjiDetail.module.css";

interface KanjiDetailProps {
  literal: string;
  onBack: () => void;
  onHome?: () => void;
  /** Tap a component to open that character's detail. */
  onOpenKanji: (literal: string) => void;
  /** Tap a containing word to open its detail. */
  onOpenWord: (id: string) => void;
  /** Open the stroke-order sub-page (animation + chart). */
  onOpenStrokeOrder: (literal: string) => void;
  /** Open the radical picker seeded with these parts — for components with no kanji detail. */
  onFindByPart: (parts: string[]) => void;
}

export const KanjiDetail = ({
  literal,
  onBack,
  onHome,
  onOpenKanji,
  onOpenWord,
  onOpenStrokeOrder,
  onFindByPart
}: KanjiDetailProps): React.ReactElement => {
  const { data, isPending, isError, error } = useQuery(kanjiQuery(literal));

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack} onHome={onHome} />
      <div className={styles.body}>
        {isPending ? (
          <p>Loading…</p>
        ) : isError ? (
          <p>{error instanceof Error ? error.message : "Failed to load."}</p>
        ) : data === null ? (
          <p>Kanji not found.</p>
        ) : (
          <KanjiBody
            kanji={data}
            onOpenKanji={onOpenKanji}
            onOpenWord={onOpenWord}
            onOpenStrokeOrder={onOpenStrokeOrder}
            onFindByPart={onFindByPart}
          />
        )}
      </div>
    </div>
  );
};

const KanjiBody = ({
  kanji,
  onOpenKanji,
  onOpenWord,
  onOpenStrokeOrder,
  onFindByPart
}: {
  kanji: KanjiDetailDto;
  onOpenKanji: (literal: string) => void;
  onOpenWord: (id: string) => void;
  onOpenStrokeOrder: (literal: string) => void;
  onFindByPart: (parts: string[]) => void;
}): React.ReactElement => (
  <>
    <div className={styles.hero}>
      {/* Copying the character is a primary action here: the point of this extension is getting
          Japanese into the document you're writing next door. */}
      <CopyButton
        className={styles.literalCopy}
        value={kanji.literal}
        label={`Copy ${kanji.literal}`}
      >
        <span className={styles.literal} lang="ja">
          {kanji.literal}
        </span>
      </CopyButton>
      <div className={styles.badges}>
        {kanji.strokeCount !== null ? (
          <Badge kind="pos">{kanji.strokeCount} strokes</Badge>
        ) : null}
        {kanji.grade !== null ? (
          <Badge kind="pos" title="School grade">
            grade {kanji.grade}
          </Badge>
        ) : null}
        {kanji.jlpt !== null ? (
          <Badge kind="common">JLPT N{kanji.jlpt}</Badge>
        ) : null}
        {kanji.frequency !== null ? (
          <Badge kind="misc" title="Newspaper frequency rank">
            freq #{kanji.frequency}
          </Badge>
        ) : null}
        <WaniKaniLink term={kanji.literal} />
      </div>
    </div>

    {kanji.meanings.length > 0 ? (
      <p className={styles.meanings}>{kanji.meanings.join(", ")}</p>
    ) : null}

    <ReadingRow label="On" readings={kanji.on} />
    <ReadingRow label="Kun" readings={kanji.kun} />
    <ReadingRow label="Nanori" readings={kanji.nanori} />

    <Button
      className={styles.strokeLink}
      onPress={() => onOpenStrokeOrder(kanji.literal)}
    >
      <span aria-hidden="true">✏️</span>
      Stroke order
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Button>

    {kanji.components.length > 0 ? (
      <div className={styles.section}>
        {/* "Parts", not "Radicals" — Kradfile is a visual decomposition, not the classical 214
            Kangxi radicals, and Jisho uses the same wording for the same data. Calling these
            radicals would overclaim. */}
        <h2>Parts</h2>
        <div className={styles.componentGrid} lang="ja">
          {kanji.components.map((c) => (
            <Button
              key={c.literal}
              className={styles.component}
              // Every part stays tappable (as on Jisho), but the destination depends on what the
              // part IS: a real kanji opens its detail; a stroke-shape proxy (ノ ハ マ ユ ヨ ｜) has
              // no Kanjidic entry, so it opens the radical picker seeded with it — "kanji built
              // from this part", which is the question tapping it actually asks.
              onPress={() =>
                c.hasDetail ? onOpenKanji(c.literal) : onFindByPart([c.literal])
              }
              aria-label={
                c.hasDetail
                  ? `Open ${c.literal}`
                  : `Find kanji containing ${c.literal}`
              }
            >
              {c.literal}
            </Button>
          ))}
        </div>
      </div>
    ) : null}

    {kanji.words.length > 0 ? (
      <div className={styles.section}>
        <h2>Words</h2>
        <ul className={styles.wordList}>
          {kanji.words.map((w) => (
            <li key={w.id}>
              <Button
                className={styles.word}
                onPress={() => onOpenWord(w.id)}
                aria-label={`Open ${w.headword}`}
              >
                <span className={styles.wordHead} lang="ja">
                  {w.headword}
                </span>
                {w.reading ? (
                  <span className={styles.wordReading} lang="ja">
                    {w.reading}
                  </span>
                ) : null}
                <span className={styles.wordGloss}>{w.glossPreview}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </>
);

const ReadingRow = ({
  label,
  readings
}: {
  label: string;
  readings: string[];
}): React.ReactElement | null => {
  if (readings.length === 0) return null;
  return (
    <p className={styles.readingRow}>
      <span className={styles.readingLabel}>
        <Term>{label}</Term>
      </span>
      <span lang="ja">{readings.join("、")}</span>
      <SequencePlayButton readings={readings} label={`${label} readings`} />
    </p>
  );
};
