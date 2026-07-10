import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import type { KanaDto, SenseDto, WordDetailDto } from "../../shared/messages";
import { wordQuery } from "../queries";
import { Badge } from "../components/Badge";
import styles from "./WordDetail.module.css";

interface WordDetailProps {
  id: string;
  onBack: () => void;
  /** Tap-through: search for a referenced term (cross-references are surface strings, not ids). */
  onSearchTerm: (term: string) => void;
}

export const WordDetail = ({
  id,
  onBack,
  onSearchTerm
}: WordDetailProps): React.ReactElement => {
  const { data, isPending, isError, error } = useQuery(wordQuery(id));

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
          <p>Word not found.</p>
        ) : (
          <WordBody word={data} onSearchTerm={onSearchTerm} />
        )}
      </div>
    </div>
  );
};

const WordBody = ({
  word,
  onSearchTerm
}: {
  word: WordDetailDto;
  onSearchTerm: (term: string) => void;
}): React.ReactElement => {
  // `word.kanji`/`word.kana` may be empty (kana-only words have no kanji); guard on length
  // rather than optional-chaining, which the array element type reports as always-present.
  const primaryKanji = word.kanji.length > 0 ? word.kanji[0].text : undefined;
  const altKanji = word.kanji.slice(1).map((k) => k.text);
  const primaryReading = word.kana.length > 0 ? word.kana[0].text : "";
  const headword = primaryKanji ?? primaryReading;

  return (
    <>
      <div className={styles.writing}>
        <span className={styles.headword} lang="ja">
          {headword}
        </span>
        {word.common ? <Badge kind="common">common</Badge> : null}
        {altKanji.length > 0 ? (
          <span className={styles.headwordAlt} lang="ja">
            {altKanji.join("、")}
          </span>
        ) : null}
        {primaryKanji ? (
          <div className={styles.readings} lang="ja">
            {word.kana.map((k) => formatReading(k)).join("、")}
          </div>
        ) : null}
      </div>

      <ol className={styles.senses}>
        {word.senses.map((sense, i) => (
          <Sense key={i} sense={sense} onSearchTerm={onSearchTerm} />
        ))}
      </ol>
    </>
  );
};

const Sense = ({
  sense,
  onSearchTerm
}: {
  sense: SenseDto;
  onSearchTerm: (term: string) => void;
}): React.ReactElement => (
  <li className={styles.sense}>
    <div className={styles.senseHead}>
      {sense.partOfSpeech.map((t) => (
        <Badge key={t.code} kind="pos" title={t.description}>
          {t.description}
        </Badge>
      ))}
      {sense.field.map((t) => (
        <Badge key={t.code} kind="misc" title={t.description}>
          {t.description}
        </Badge>
      ))}
      {sense.misc.map((t) => (
        <Badge key={t.code} kind="misc" title={t.description}>
          {t.description}
        </Badge>
      ))}
    </div>
    <ol className={styles.glossList}>
      {sense.glosses.map((g, i) => (
        <li key={i} className={styles.gloss}>
          {g}
        </li>
      ))}
    </ol>
    {sense.info.length > 0 ? (
      <p className={styles.info}>{sense.info.join("; ")}</p>
    ) : null}
    <XrefLine
      label="See also"
      terms={sense.related}
      onSearchTerm={onSearchTerm}
    />
    <XrefLine
      label="Antonym"
      terms={sense.antonym}
      onSearchTerm={onSearchTerm}
    />
  </li>
);

/** Cross-references as tappable links: clicking one searches for that term. */
const XrefLine = ({
  label,
  terms,
  onSearchTerm
}: {
  label: string;
  terms: string[];
  onSearchTerm: (term: string) => void;
}): React.ReactElement | null => {
  if (terms.length === 0) return null;
  return (
    <p className={styles.xrefs} lang="ja">
      <span className={styles.xrefLabel}>{label}: </span>
      {terms.map((term, i) => (
        <span key={term}>
          {i > 0 ? "、" : null}
          <Button
            className={styles.xrefLink}
            onPress={() => onSearchTerm(term)}
            aria-label={`Search for ${term}`}
          >
            {term}
          </Button>
        </span>
      ))}
    </p>
  );
};

/** A reading, annotated with which kanji it applies to when it isn't universal. */
const formatReading = (kana: KanaDto): string => {
  const universal =
    kana.appliesToKanji.length === 0 || kana.appliesToKanji.includes("*");
  return universal
    ? kana.text
    : `${kana.text} (${kana.appliesToKanji.join("、")})`;
};
