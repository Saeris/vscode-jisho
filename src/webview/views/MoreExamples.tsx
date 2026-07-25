import { useQuery } from "@tanstack/react-query";
import type { ExampleGroupDto, PoolSentenceDto } from "../../shared/messages";
import { moreExamplesQuery } from "../queries";
import { DetailHeader } from "../components/DetailHeader";
import { Ruby } from "../components/Ruby";
import styles from "./MoreExamples.module.css";

interface MoreExamplesProps {
  id: string;
  onBack: () => void;
  onHome?: () => void;
}

/**
 * The "more examples" page (F1): the fuller Tatoeba example pool for a word. Sentences the source
 * tagged to a specific sense are grouped under that sense's gloss; the rest fall under a general
 * word-level section. Each sentence renders build-time furigana (stored as `{漢字|かんじ}` ruby).
 */
export const MoreExamples = ({
  id,
  onBack,
  onHome
}: MoreExamplesProps): React.ReactElement => {
  const { data, isPending, isError, error } = useQuery(moreExamplesQuery(id));

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack} onHome={onHome} />
      <div className={styles.body}>
        {isPending ? (
          <p>Loading…</p>
        ) : isError ? (
          <p>{error instanceof Error ? error.message : "Failed to load."}</p>
        ) : data === null ||
          (data.senses.length === 0 && data.wordLevel.length === 0) ? (
          <p className={styles.empty}>No additional examples for this word.</p>
        ) : (
          <>
            <h1 className={styles.title}>
              Examples for <span lang="ja">{data.headword}</span>
            </h1>
            {data.senses.map((group, i) => (
              // eslint-disable-next-line react/no-array-index-key -- groups are positional, sense order
              <SenseGroup key={i} group={group} />
            ))}
            {data.wordLevel.length > 0 ? (
              <section className={styles.group}>
                {/* Only label the word-level pool as "more" when senses were shown above it, so a
                    word with no sense-tagged examples doesn't get a redundant header. */}
                {data.senses.length > 0 ? (
                  <h2 className={styles.groupHead}>More examples</h2>
                ) : null}
                <SentenceList sentences={data.wordLevel} />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

const SenseGroup = ({
  group
}: {
  group: ExampleGroupDto;
}): React.ReactElement => (
  <section className={styles.group}>
    {group.gloss ? <h2 className={styles.groupHead}>{group.gloss}</h2> : null}
    <SentenceList sentences={group.sentences} />
  </section>
);

const SentenceList = ({
  sentences
}: {
  sentences: PoolSentenceDto[];
}): React.ReactElement => (
  <ul className={styles.list}>
    {sentences.map((s, i) => (
      // eslint-disable-next-line react/no-array-index-key -- sentences are positional within a group
      <li key={i} className={styles.item}>
        <span className={styles.ja} lang="ja">
          <Ruby markup={s.jaFurigana} />
        </span>
        <span className={styles.en}>{s.en}</span>
      </li>
    ))}
  </ul>
);
