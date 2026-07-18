import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Heading } from "react-aria-components";
import type {
  KanaDto,
  SenseDto,
  SentenceDto,
  WordDetailDto
} from "../../shared/messages";
import { wordQuery } from "../queries";
import { conjugate } from "../conjugate";
import { Badge } from "../components/Badge";
import { JlptBadge } from "../components/JlptBadge";
import { PitchAccent } from "../components/PitchAccent";
import { WaniKaniLink } from "../components/WaniKaniLink";
import { DetailHeader } from "../components/DetailHeader";
import { Term } from "../components/Term";
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
        <WaniKaniLink term={headword} />
        {/* Kana-only words show their reading as the headword, so surface pitch here. */}
        {!primaryKanji && word.kana.length > 0 ? (
          <PitchAccent
            reading={word.kana[0].text}
            accents={word.kana[0].pitchAccents}
          />
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
                <Reading kana={k} />
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

      <Conjugations headword={headword} word={word} />
    </>
  );
};

/**
 * A conjugated form with the part that differs from the dictionary form emphasised — the eye can
 * find "what got added" without re-deriving the stem. Longest common code-point prefix against the
 * dictionary form; forms that replace the whole word (ある → ない) emphasise everything, which is
 * exactly the warning they deserve.
 */
const Inflected = ({
  dict,
  text
}: {
  dict: string;
  text: string;
}): React.ReactElement => {
  const base = Array.from(dict);
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length && i < base.length && chars[i] === base[i]) i++;
  return (
    <>
      {chars.slice(0, i).join("")}
      <span className={styles.inflection}>{chars.slice(i).join("")}</span>
    </>
  );
};

/**
 * Word-level conjugation table (Shirabe-style), a plain visible section — the split from the
 * senses is the heading, not a collapse. Renders nothing for non-conjugable words — the engine's
 * null IS the gate.
 */
const Conjugations = ({
  headword,
  word
}: {
  headword: string;
  word: WordDetailDto;
}): React.ReactElement | null => {
  const rows = conjugate(
    headword,
    word.senses.flatMap((s) => s.partOfSpeech.map((t) => t.code))
  );
  if (rows === null) return null;
  return (
    <section className={styles.conjugations}>
      <Heading level={3} className={styles.sectionHeading}>
        Conjugations
      </Heading>
      <table className={styles.conjTable}>
        <thead>
          <tr>
            <th scope="col">Form</th>
            <th scope="col">Affirmative</th>
            <th scope="col">Negative</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.form}>
              <th scope="row">
                <Term>{r.form}</Term>
              </th>
              <td lang="ja">
                <Inflected dict={headword} text={r.affirmative} />
                {r.colloquial === undefined ? null : (
                  <>
                    {" ("}
                    <Inflected dict={headword} text={r.colloquial} />
                    {")"}
                  </>
                )}
              </td>
              <td lang="ja">
                {r.negative === "" ? (
                  "—"
                ) : (
                  <Inflected dict={headword} text={r.negative} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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

/** How many example sentences a sense shows before "Show all". */
const EXAMPLE_PREVIEW = 2;

/**
 * Example sentences for a sense: the first couple visible inline (no collapse — hiding them made
 * the page read as if it had none), the rest behind "Show all". A dedicated examples page will
 * replace the in-place expansion once it exists (BACKLOG #20c).
 */
const Examples = ({
  sentences
}: {
  sentences: SentenceDto[];
}): React.ReactElement => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sentences : sentences.slice(0, EXAMPLE_PREVIEW);
  return (
    <div className={styles.examples}>
      <ul className={styles.exampleList}>
        {visible.map((s, i) => (
          <li key={i} className={styles.example}>
            <span className={styles.exampleJa} lang="ja">
              {s.ja}
            </span>
            <span className={styles.exampleEn}>{s.en}</span>
          </li>
        ))}
      </ul>
      {sentences.length > EXAMPLE_PREVIEW && !expanded ? (
        <Button
          className={styles.examplesTrigger}
          onPress={() => setExpanded(true)}
        >
          Show all ({sentences.length})
        </Button>
      ) : null}
    </div>
  );
};

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

/**
 * A reading: the kana with its pitch-accent contour drawn over it when known (else plain kana),
 * plus a "(applies to …)" note when the reading isn't universal across the word's kanji writings.
 */
const Reading = ({ kana }: { kana: KanaDto }): React.ReactElement => {
  const universal =
    kana.appliesToKanji.length === 0 || kana.appliesToKanji.includes("*");
  return (
    <>
      {kana.pitchAccents.length > 0 ? (
        <PitchAccent reading={kana.text} accents={kana.pitchAccents} />
      ) : (
        kana.text
      )}
      {universal ? null : ` (${kana.appliesToKanji.join("、")})`}
    </>
  );
};
