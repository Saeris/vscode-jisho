import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import type { KanjiDetailDto } from "../../shared/messages";
import { kanjiQuery } from "../queries";
import { Badge } from "../components/Badge";
import styles from "./KanjiDetail.module.css";

interface KanjiDetailProps {
  literal: string;
  onBack: () => void;
  /** Tap a component to open that character's detail. */
  onOpenKanji: (literal: string) => void;
  /** Tap a containing word to open its detail. */
  onOpenWord: (id: string) => void;
}

export const KanjiDetail = ({
  literal,
  onBack,
  onOpenKanji,
  onOpenWord
}: KanjiDetailProps): React.ReactElement => {
  const { data, isPending, isError, error } = useQuery(kanjiQuery(literal));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Button
          className={styles.back}
          onPress={onBack}
          aria-label="Back to results"
        >
          ← Back
        </Button>
      </div>
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
          />
        )}
      </div>
    </div>
  );
};

const KanjiBody = ({
  kanji,
  onOpenKanji,
  onOpenWord
}: {
  kanji: KanjiDetailDto;
  onOpenKanji: (literal: string) => void;
  onOpenWord: (id: string) => void;
}): React.ReactElement => (
  <>
    <div className={styles.hero}>
      <span className={styles.literal} lang="ja">
        {kanji.literal}
      </span>
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
      </div>
    </div>

    {kanji.meanings.length > 0 ? (
      <p className={styles.meanings}>{kanji.meanings.join(", ")}</p>
    ) : null}

    <ReadingRow label="On" readings={kanji.on} />
    <ReadingRow label="Kun" readings={kanji.kun} />
    <ReadingRow label="Nanori" readings={kanji.nanori} />

    {kanji.components.length > 0 ? (
      <div className={styles.section}>
        <h2>Components</h2>
        <div className={styles.componentGrid} lang="ja">
          {kanji.components.map((c) => (
            <Button
              key={c}
              className={styles.component}
              onPress={() => onOpenKanji(c)}
              aria-label={`Open ${c}`}
            >
              {c}
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
      <span className={styles.readingLabel}>{label}</span>
      <span lang="ja">{readings.join("、")}</span>
    </p>
  );
};
