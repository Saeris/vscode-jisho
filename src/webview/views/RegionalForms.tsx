import { createContext, useContext, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  ToggleButton,
  ToggleButtonGroup,
  type Selection
} from "react-aria-components";
import type {
  NoteBlock,
  NoteItem,
  RegionalGroupDto
} from "../../shared/messages";
import { CopyButton } from "../components/CopyButton";
import { DetailView } from "../components/DetailView";
import { Overprint } from "../components/Overprint";
import { Term } from "../components/Term";
import { useNavigate } from "../navigation";
import { regionalFormsQuery } from "../queries";
import {
  COLUMN_LANGS,
  codePointOf,
  columnNames,
  formRows,
  inkOf,
  meaningsOf,
  noteRows,
  strokeText,
  usageRows,
  type MeaningsRow,
  type NoteRow,
  type UsageRow
} from "../regionalForms";
import styles from "./RegionalForms.module.css";

type Mode = "stack" | "separate";

/**
 * How China, Hong Kong, Taiwan and Japan write a kanji (spec 22): the overprint, a chart with one
 * row per distinct form (a learner's question is "which forms exist, and who uses each", and a
 * column per region would not fit the sidebar), and English-language links for each form.
 *
 * Several groups when Japan writes several characters alike (弁 stands for 辨, 瓣, 辯 and 辦).
 */
export const RegionalForms = ({
  literal
}: {
  literal: string;
}): React.ReactElement => {
  const [mode, setMode] = useState<Mode>("stack");
  const [outline, setOutline] = useState(false);

  // Morph each layer into its place, unless the reader asked for less motion: then a plain switch.
  const switchMode = (next: Mode): void => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode(next);
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => setMode(next));
    });
  };

  return (
    <DetailView
      query={useQuery(regionalFormsQuery(literal))}
      empty="This kanji is on none of the regions' lists."
      context="regional forms"
      isEmpty={(groups) => groups.length === 0}
      above={
        <h1 className={styles.title}>
          <span lang="ja">{literal}</span> regional forms
        </h1>
      }
    >
      {(groups) => (
        <>
          <div className={styles.controls}>
            <ToggleButtonGroup
              aria-label="Show the forms"
              className={styles.toggle}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([mode])}
              onSelectionChange={(keys: Selection) => {
                if (keys === "all") return;
                const next = keys.values().next().value;
                if (next === "stack" || next === "separate") switchMode(next);
              }}
            >
              <ToggleButton id="stack" className={styles.toggleButton}>
                Overprint
              </ToggleButton>
              <ToggleButton id="separate" className={styles.toggleButton}>
                Separate
              </ToggleButton>
            </ToggleButtonGroup>
            <ToggleButton
              className={styles.toggleButton}
              isSelected={outline}
              onChange={setOutline}
            >
              Outline
            </ToggleButton>
          </div>
          {groups.map((group, index) => (
            <GroupSection
              key={group.key}
              group={group}
              index={index}
              titled={groups.length > 1}
              mode={mode}
              outline={outline}
            />
          ))}
        </>
      )}
    </DetailView>
  );
};

const GroupSection = ({
  group,
  index,
  titled,
  mode,
  outline
}: {
  group: RegionalGroupDto;
  index: number;
  titled: boolean;
  mode: Mode;
  outline: boolean;
}): React.ReactElement => {
  const rows = formRows(group);
  const chars = [...new Set(rows.map((row) => row.char))];
  // 返: every form one code point. Said once for the group, not on every row.
  const oneCodePoint =
    rows.length > 1 &&
    rows.every((row) => row.codePoint === rows[0]?.codePoint);
  return (
    <section className={styles.group} aria-label={`The forms of ${group.key}`}>
      {titled ? (
        <h2 className={styles.groupTitle} lang="zh-Hant">
          {group.key}
        </h2>
      ) : null}
      <Overprint
        rows={rows}
        mode={mode}
        outline={outline}
        name={`regional-${index}`}
      />
      <p className={styles.count}>
        {rows.length === 1
          ? "One form, written the same way everywhere"
          : oneCodePoint
            ? `${rows.length} forms of one code point, ${rows[0]?.codePoint ?? ""}`
            : `${rows.length} forms`}
      </p>
      <ul className={styles.chart}>
        {rows.map((row, rowIndex) => (
          <li
            key={`${row.char}-${row.columns.join("")}`}
            className={styles.row}
          >
            {/* Copied on a click, as the kanji page's character is: the form is what a reader came
                for, and its code point stays in the facts beside it. */}
            <CopyButton
              className={styles.formCopy}
              value={row.char}
              label={`Copy ${row.char} (${columnNames(row.columns)})`}
            >
              <span
                className={styles.form}
                lang={COLUMN_LANGS[row.columns[0] ?? 3]}
                style={{
                  fontFamily: `"${row.family}"`,
                  "--ink": inkOf(rowIndex)
                }}
              >
                {row.char}
              </span>
            </CopyButton>
            <span className={styles.facts}>
              <span className={styles.regions}>{columnNames(row.columns)}</span>
              <span>
                {[row.codePoint, strokeText(group, row)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {row.lists.length > 0 ? (
                <span className={styles.muted}>{row.lists.join(" · ")}</span>
              ) : null}
              {row.sharesCodePoint && !oneCodePoint ? (
                <span className={styles.muted}>
                  Same code point as another form here, drawn differently
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <Details group={group} />
      <p className={styles.links}>
        {chars.map((char) => (
          <span key={char} className={styles.link}>
            <span lang="zh-Hant">{char}</span>
            <a
              href={`https://en.wiktionary.org/wiki/${encodeURIComponent(char)}`}
            >
              Wiktionary
            </a>
            <a
              href={`https://www.unicode.org/cgi-bin/GetUnihanData.pl?codepoint=${codePointOf(char).slice(2)}`}
            >
              Unihan
            </a>
          </span>
        ))}
      </p>
    </section>
  );
};

/**
 * A Jyutping reading with each tone digit raised, as Wiktionary sets it: "gwok3" otherwise reads as
 * a word with a number in it. The "Cantonese" label beside it says what the number is.
 */
const Jyutping = ({ reading }: { reading: string }): React.ReactElement => (
  <>
    {reading
      .split(/([1-6])/u)
      .map((part, index) =>
        index % 2 === 1 ? <sup key={index}>{part}</sup> : part
      )}
  </>
);

/** The character a quote is from, in its region's font, and a link to that section of its page. */
const Source = ({
  char,
  lang,
  family,
  url,
  section
}: {
  char: string;
  lang: string;
  family: string;
  url: string;
  section: string;
}): React.ReactElement => (
  <>
    <span
      className={styles.noteChar}
      lang={lang}
      style={{ fontFamily: `"${family}"` }}
    >
      {char}
    </span>{" "}
    <a href={url}>{section} section on Wiktionary</a>
  </>
);

/** The characters quoted text may link, and how to open one: provided once by `Details`. */
const KanjiLinks = createContext<{
  links: ReadonlySet<string>;
  open: (literal: string) => void;
}>({ links: new Set(), open: () => undefined });

/**
 * Quoted text with each character that has a kanji page as a link to it (asked for): 学's note names
 * 學, and 學 is a page one tap away. The host sends only characters the dictionary has, so a link
 * never leads nowhere; the rest (a component like 𦥑) stays plain text.
 */
const Quoted = ({ text }: { text: string }): React.ReactElement => {
  const { links, open } = useContext(KanjiLinks);
  const parts: React.ReactNode[] = [];
  let plain = "";
  for (const char of text) {
    if (!links.has(char)) {
      plain += char;
      continue;
    }
    if (plain !== "") parts.push(plain);
    plain = "";
    parts.push(
      <Link
        key={parts.length}
        className={styles.kanjiLink}
        onPress={() => open(char)}
      >
        {char}
      </Link>
    );
  }
  if (plain !== "") parts.push(plain);
  return <>{parts}</>;
};

/** The Chinese meanings, quoted and credited like the notes: from a page, with its link. */
const ChineseMeanings = ({
  meanings
}: {
  meanings: MeaningsRow;
}): React.ReactElement => (
  <blockquote className={styles.note} cite={meanings.url}>
    <ol className={styles.meanings}>
      {meanings.senses.map((sense) => (
        <li key={sense.gloss}>
          <Quoted text={sense.gloss} />
          {sense.labels.length > 0 ? (
            <span className={styles.muted}> · {sense.labels.join(", ")}</span>
          ) : null}
        </li>
      ))}
    </ol>
    <footer className={styles.muted}>
      <Source {...meanings} section="Chinese" />
    </footer>
  </blockquote>
);

/** A note's items, nested as the page nests them. */
const NoteItems = ({
  items,
  ordered
}: {
  items: readonly NoteItem[];
  ordered: boolean;
}): React.ReactElement => {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={styles.noteList}>
      {items.map((item, index) => (
        <li key={index}>
          <Quoted text={item.text} />
          {item.items.length > 0 ? (
            <NoteItems items={item.items} ordered={ordered} />
          ) : null}
        </li>
      ))}
    </List>
  );
};

/** A note's blocks: paragraphs, the labels of the senses it discusses, and lists. */
const NoteBlocks = ({
  blocks
}: {
  blocks: readonly NoteBlock[];
}): React.ReactElement => (
  <>
    {blocks.map((block, index) =>
      block.kind === "list" ? (
        <NoteItems key={index} items={block.items} ordered={block.ordered} />
      ) : (
        <p
          key={index}
          className={
            block.kind === "label"
              ? styles.noteLabel
              : block.indent
                ? styles.noteIndent
                : undefined
          }
        >
          <Quoted text={block.text} />
        </p>
      )
    )}
  </>
);

/** A Wiktionary note quoted whole, with a link to the section it is from. */
const Note = ({ note }: { note: NoteRow }): React.ReactElement => (
  <blockquote className={styles.note} cite={note.url}>
    <NoteBlocks blocks={note.blocks} />
    <footer className={styles.muted}>
      <Source {...note} />
    </footer>
  </blockquote>
);

/** Each region's pronunciation of its form, and how common the form is in its region's corpus. */
const Usage = ({ rows }: { rows: readonly UsageRow[] }): React.ReactElement => (
  <dl className={styles.usage}>
    {rows.map((row) => (
      <div key={row.region} className={styles.usageRow}>
        <dt className={styles.regions}>
          {row.region} <span lang={row.lang}>{row.char}</span>
        </dt>
        <dd>
          {row.reading === null ? (
            <span className={styles.muted}>No {row.readingName} reading</span>
          ) : (
            <>
              <span lang={row.readingLang}>
                {row.readingLang === "yue-Latn-jyutping" ? (
                  <Jyutping reading={row.reading} />
                ) : (
                  row.reading
                )}
              </span>{" "}
              <span className={styles.muted}>
                (<Term>{row.readingName}</Term>)
              </span>
            </>
          )}
        </dd>
        <dd className={styles.muted}>{row.rank}</dd>
      </div>
    ))}
  </dl>
);

/** One of a language entry's parts, left out when it has nothing to say. */
const Part = ({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement => (
  <>
    <h5 className={styles.part}>{title}</h5>
    {children}
  </>
);

/**
 * Details (asked for): how the forms relate across languages, then one entry per language, Japanese
 * first. Each gives its pronunciations (a region's reading and frequency), its meaning and its
 * etymology. By language, not by region: a meaning and an etymology belong to a character in a
 * language, so Hong Kong and Taiwan, who both write 學, would otherwise repeat them. A part with
 * nothing to show is left out.
 */
const Details = ({
  group
}: {
  group: RegionalGroupDto;
}): React.ReactElement => {
  const { openKanji } = useNavigate();
  const notes = noteRows(group);
  const usage = usageRows(group);
  const chineseMeanings = meaningsOf(group);
  const notesIn = (section: NoteRow["section"]): React.ReactNode =>
    notes
      .filter((note) => note.section === section)
      .map((note) => <Note key={note.char} note={note} />);
  const across = notes.filter((note) => note.section === "Translingual");
  const japanese = notes.filter((note) => note.section === "Japanese");
  const chinese = notes.filter((note) => note.section === "Chinese");
  return (
    <KanjiLinks.Provider
      value={{ links: new Set(group.kanjiLinks), open: openKanji }}
    >
      <h3 className={styles.subheading}>Details</h3>
      {across.length > 0 ? (
        <section>
          <h4 className={styles.language}>Across languages</h4>
          {notesIn("Translingual")}
        </section>
      ) : null}
      <section>
        <h4 className={styles.language}>Japanese</h4>
        <Part title="Pronunciation and frequency">
          <Usage rows={usage.filter((row) => row.language === "Japanese")} />
        </Part>
        {group.japaneseMeanings.length > 0 ? (
          <Part title="Meaning">
            <p className={styles.meaning}>
              {group.japaneseMeanings.join(", ")}
            </p>
          </Part>
        ) : null}
        {japanese.length > 0 ? (
          <Part title="Etymology">{notesIn("Japanese")}</Part>
        ) : null}
      </section>
      <section>
        <h4 className={styles.language}>Chinese</h4>
        <Part title="Pronunciation and frequency">
          <Usage rows={usage.filter((row) => row.language === "Chinese")} />
        </Part>
        {chineseMeanings === null ? null : (
          <Part title="Meaning">
            <ChineseMeanings meanings={chineseMeanings} />
          </Part>
        )}
        {chinese.length > 0 ? (
          <Part title="Etymology">{notesIn("Chinese")}</Part>
        ) : null}
      </section>
      {notes.length > 0 || chineseMeanings !== null ? (
        <p className={`${styles.credit} ${styles.muted}`}>
          Text from English Wiktionary, under{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/">
            CC BY-SA 4.0
          </a>
          .
        </p>
      ) : null}
    </KanjiLinks.Provider>
  );
};
