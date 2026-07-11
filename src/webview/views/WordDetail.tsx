import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading
} from "react-aria-components";
import type {
  KanaDto,
  SenseDto,
  SentenceDto,
  WordDetailDto
} from "../../shared/messages";
import { wordQuery } from "../queries";
import { Badge } from "../components/Badge";
import { JlptBadge } from "../components/JlptBadge";
import { PitchBadge } from "../components/PitchBadge";
import { DetailHeader } from "../components/DetailHeader";
import { PlayButton } from "../components/PlayButton";
import styles from "./WordDetail.module.css";

interface WordDetailProps {
  id: string;
  onBack: () => void;
  onHome?: () => void;
  /** Tap-through: search for a referenced term (cross-references are surface strings, not ids). */
  onSearchTerm: (term: string) => void;
  /** Tap a kanji character in the headword to open its detail. */
  onOpenKanji: (literal: string) => void;
}

export const WordDetail = ({
  id,
  onBack,
  onHome,
  onSearchTerm,
  onOpenKanji
}: WordDetailProps): React.ReactElement => {
  const { data, isPending, isError, error } = useQuery(wordQuery(id));

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack} onHome={onHome} />
      <div className={styles.body}>
        {isPending ? (
          <p>Loading…</p>
        ) : isError ? (
          <p>{error instanceof Error ? error.message : "Failed to load."}</p>
        ) : data === null ? (
          <p>Word not found.</p>
        ) : (
          <WordBody
            word={data}
            onSearchTerm={onSearchTerm}
            onOpenKanji={onOpenKanji}
          />
        )}
      </div>
    </div>
  );
};

const WordBody = ({
  word,
  onSearchTerm,
  onOpenKanji
}: {
  word: WordDetailDto;
  onSearchTerm: (term: string) => void;
  onOpenKanji: (literal: string) => void;
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
          <Headword text={headword} onOpenKanji={onOpenKanji} />
        </span>
        <PlayButton
          text={primaryReading || headword}
          label={`Play pronunciation of ${headword}`}
        />
        {word.common ? <Badge kind="common">common</Badge> : null}
        <JlptBadge level={word.jlpt} />
        {/* Kana-only words show their reading as the headword, so surface pitch here. */}
        {!primaryKanji && word.kana.length > 0 ? (
          <PitchBadge accents={word.kana[0].pitchAccents} />
        ) : null}
        {altKanji.length > 0 ? (
          <span className={styles.headwordAlt} lang="ja">
            {altKanji.join("、")}
          </span>
        ) : null}
        {primaryKanji ? (
          <div className={styles.readings} lang="ja">
            {word.kana.map((k, i) => (
              <span key={i} className={styles.reading}>
                {i > 0 ? <span className={styles.readingSep}>、</span> : null}
                {formatReading(k)}
                <PitchBadge accents={k.pitchAccents} />
              </span>
            ))}
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

const CJK = /[㐀-鿿豈-﫿]/u;

/** The headword with each CJK character rendered as a button that opens its kanji detail. */
const Headword = ({
  text,
  onOpenKanji
}: {
  text: string;
  onOpenKanji: (literal: string) => void;
}): React.ReactElement => (
  <>
    {Array.from(text).map((char, i) =>
      CJK.test(char) ? (
        <Button
          key={i}
          className={styles.kanjiChar}
          onPress={() => onOpenKanji(char)}
          aria-label={`Open kanji ${char}`}
        >
          {char}
        </Button>
      ) : (
        <span key={i}>{char}</span>
      )
    )}
  </>
);

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
    {sense.sentences.length > 0 ? (
      <Examples sentences={sense.sentences} />
    ) : null}
  </li>
);

/** Collapsible example-sentence section for a sense: Japanese sentence over its English gloss. */
const Examples = ({
  sentences
}: {
  sentences: SentenceDto[];
}): React.ReactElement => (
  <Disclosure className={styles.examples}>
    <Heading level={4} className={styles.examplesHeading}>
      <Button slot="trigger" className={styles.examplesTrigger}>
        Examples ({sentences.length})
      </Button>
    </Heading>
    <DisclosurePanel>
      <ul className={styles.exampleList}>
        {sentences.map((s, i) => (
          <li key={i} className={styles.example}>
            <span className={styles.exampleJa} lang="ja">
              {s.ja}
            </span>
            <span className={styles.exampleEn}>{s.en}</span>
          </li>
        ))}
      </ul>
    </DisclosurePanel>
  </Disclosure>
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
