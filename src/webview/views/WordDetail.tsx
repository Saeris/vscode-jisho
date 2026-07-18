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

/** The kanji writings a reading applies to (Shirabe's 【】group): all of them, or its subset. */
const writingsFor = (kana: KanaDto, word: WordDetailDto): string[] => {
  if (word.kanji.length === 0) return [];
  const universal =
    kana.appliesToKanji.length === 0 || kana.appliesToKanji.includes("*");
  return universal ? word.kanji.map((k) => k.text) : kana.appliesToKanji;
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
  const headword =
    word.kanji.length > 0
      ? word.kanji[0].text
      : word.kana.length > 0
        ? word.kana[0].text
        : "";

  return (
    <>
      {/* Shirabe-style headword: each reading on its own line — kana first, then the kanji
          writings THAT reading applies to in 【】. This renders appliesToKanji for free
          (一月: ひとつき【一月, ひと月】 over いちげつ【一月】). */}
      <div className={styles.writing}>
        {word.kana.map((kana, i) => (
          <div key={i} className={styles.headline} lang="ja">
            <span className={styles.headKana}>
              {kana.pitchAccents.length > 0 ? (
                <PitchAccent reading={kana.text} accents={kana.pitchAccents} />
              ) : (
                kana.text
              )}
            </span>
            {writingsFor(kana, word).length > 0 ? (
              <span className={styles.headWritings}>
                【
                <Headword
                  text={writingsFor(kana, word).join(", ")}
                  onOpenKanji={onOpenKanji}
                />
                】
              </span>
            ) : null}
            <PlayButton
              text={kana.text}
              label={`Play pronunciation of ${kana.text}`}
            />
          </div>
        ))}
        <div className={styles.tagRow}>
          {word.common ? <Badge kind="common">common</Badge> : null}
          <JlptBadge level={word.jlpt} />
          <WaniKaniLink term={headword} />
        </div>
      </div>

      <SenseList word={word} onSearchTerm={onSearchTerm} />

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

/** The muted grammar line above a run of senses: parts of speech plus usage tags, spelled out. */
const senseLabel = (sense: SenseDto): string =>
  [...sense.partOfSpeech, ...sense.misc].map((t) => t.description).join(", ");

/** Ⓐ Ⓑ Ⓒ … — Shirabe's sense markers; they double as keys for per-sense example sections. */
const senseMarker = (index: number): string =>
  index < 26 ? String.fromCodePoint(0x24b6 + index) : `(${index + 1})`;

/**
 * Senses grouped Shirabe-style: the POS/usage line appears once above the run of senses it
 * governs and again only when it changes (見せる: "Ichidan verb, transitive verb" for Ⓐ–Ⓔ, then
 * "auxiliary verb" for Ⓕ–Ⓖ). Sense letters run through the whole word, not per group.
 */
const SenseList = ({
  word,
  onSearchTerm
}: {
  word: WordDetailDto;
  onSearchTerm: (term: string) => void;
}): React.ReactElement => (
  <div className={styles.senses}>
    {word.senses.map((sense, i) => {
      const label = senseLabel(sense);
      const changed = i === 0 || label !== senseLabel(word.senses[i - 1]);
      return (
        <div key={i} className={styles.senseRun}>
          {changed && label !== "" ? (
            <p className={styles.posLine}>{label}</p>
          ) : null}
          <Sense sense={sense} index={i} onSearchTerm={onSearchTerm} />
        </div>
      );
    })}
  </div>
);

/** A muted inline annotation: " (label: linked terms)" — Shirabe's xref formatting. */
const InlineXrefs = ({
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
    <span className={styles.senseNote} lang="ja">
      {" ("}
      {label}
      {": "}
      {terms.map((term, i) => (
        <span key={term}>
          {i > 0 ? ", " : null}
          <Button
            className={styles.xrefLink}
            onPress={() => onSearchTerm(term)}
            aria-label={`Search for ${term}`}
          >
            {term}
          </Button>
        </span>
      ))}
      {")"}
    </span>
  );
};

const Sense = ({
  sense,
  index,
  onSearchTerm
}: {
  sense: SenseDto;
  index: number;
  onSearchTerm: (term: string) => void;
}): React.ReactElement => {
  const notes = [
    ...sense.field.map((t) => t.description),
    ...sense.dialect.map((t) => t.description),
    ...sense.info
  ];
  return (
    <div className={styles.sense}>
      <span className={styles.senseMarker} aria-hidden="true">
        {senseMarker(index)}
      </span>
      <p className={styles.senseBody}>
        {sense.glosses.join(", ")}
        {notes.length > 0 ? (
          <span className={styles.senseNote}> ({notes.join("; ")})</span>
        ) : null}
        <InlineXrefs
          label="see also"
          terms={sense.related}
          onSearchTerm={onSearchTerm}
        />
        <InlineXrefs
          label="antonyms"
          terms={sense.antonym}
          onSearchTerm={onSearchTerm}
        />
      </p>
      {sense.sentences.length > 0 ? (
        <Examples sentences={sense.sentences} />
      ) : null}
    </div>
  );
};

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
