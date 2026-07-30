import { useQuery } from "@tanstack/react-query";
import type { ExampleGroupDto, PoolSentenceDto } from "../../shared/messages";
import { moreExamplesQuery } from "../queries";
import { DetailView } from "../components/DetailView";
import { ExampleSentence } from "../components/ExampleSentence";
import styles from "./MoreExamples.module.css";

interface MoreExamplesProps {
  id: string;
  onBack: () => void;
  onHome?: () => void;
  /** Tap a word in an example to open its entry directly (F1-links, open-by-id). */
  onOpenWord: (id: string) => void;
}

/**
 * The "more examples" page (F1): the fuller Tatoeba example pool for a word. Sentences the source
 * tagged to a specific sense are grouped under that sense's gloss; the rest fall under a general
 * word-level section. Each sentence renders build-time furigana (stored as `{漢字|かんじ}` ruby).
 */
export const MoreExamples = ({
  id,
  onBack,
  onHome,
  onOpenWord
}: MoreExamplesProps): React.ReactElement => {
  return (
    <DetailView
      query={useQuery(moreExamplesQuery(id))}
      onBack={onBack}
      onHome={onHome}
      empty="No additional examples for this word."
      isEmpty={(data) =>
        data.senses.length === 0 && data.wordLevel.length === 0
      }
    >
      {(data) => (
        <>
          <h1 className={styles.title}>
            Examples for <span lang="ja">{data.headword}</span>
          </h1>
          {data.senses.map((group, i) => (
            // eslint-disable-next-line react/no-array-index-key -- groups are positional, sense order
            <SenseGroup key={i} group={group} onOpenWord={onOpenWord} />
          ))}
          {data.wordLevel.length > 0 ? (
            <section className={styles.group}>
              {/* Only label the word-level pool as "more" when senses were shown above it, so a
                    word with no sense-tagged examples doesn't get a redundant header. */}
              {data.senses.length > 0 ? (
                <h2 className={styles.groupHead}>More examples</h2>
              ) : null}
              <SentenceList
                sentences={data.wordLevel}
                onOpenWord={onOpenWord}
              />
            </section>
          ) : null}
        </>
      )}
    </DetailView>
  );
};

const SenseGroup = ({
  group,
  onOpenWord
}: {
  group: ExampleGroupDto;
  onOpenWord: (id: string) => void;
}): React.ReactElement => (
  <section className={styles.group}>
    {group.gloss ? <h2 className={styles.groupHead}>{group.gloss}</h2> : null}
    <SentenceList sentences={group.sentences} onOpenWord={onOpenWord} />
  </section>
);

const SentenceList = ({
  sentences,
  onOpenWord
}: {
  sentences: PoolSentenceDto[];
  onOpenWord: (id: string) => void;
}): React.ReactElement => (
  <ul className={styles.list}>
    {sentences.map((s, i) => (
      // eslint-disable-next-line react/no-array-index-key -- sentences are positional within a group
      <li key={i} className={styles.item}>
        <span className={styles.ja} lang="ja">
          <ExampleSentence markup={s.jaFurigana} onOpenWord={onOpenWord} />
        </span>
        <span className={styles.en}>{s.en}</span>
      </li>
    ))}
  </ul>
);
