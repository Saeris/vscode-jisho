import { useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ToggleButton,
  ToggleButtonGroup,
  type Selection
} from "react-aria-components";
import type { RegionalGroupDto } from "../../shared/messages";
import { DetailView } from "../components/DetailView";
import { Overprint } from "../components/Overprint";
import { regionalFormsQuery } from "../queries";
import {
  COLUMN_LANGS,
  codePointOf,
  columnNames,
  formRows,
  inkOf,
  noteRows,
  strokeText,
  usageRows
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
      <h3 className={styles.subheading}>Readings and frequency</h3>
      <dl className={styles.usage}>
        {usageRows(group).map((row) => (
          <div key={row.region} className={styles.usageRow}>
            <dt className={styles.regions}>
              {row.region} <span lang={row.lang}>{row.char}</span>
            </dt>
            <dd>
              {row.reading === null ? (
                <span className={styles.muted}>
                  No {row.readingName} reading
                </span>
              ) : (
                <>
                  <span lang={row.readingLang}>{row.reading}</span>{" "}
                  <span className={styles.muted}>({row.readingName})</span>
                </>
              )}
            </dd>
            <dd className={styles.muted}>{row.rank}</dd>
          </div>
        ))}
      </dl>
      <WiktionaryNotes group={group} />
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
 * "From Wiktionary" (spec 22, phase 6): what its pages say of how the forms relate and where the
 * shape came from, quoted with a link to each page and the CC BY-SA credit its licence asks for.
 */
const WiktionaryNotes = ({
  group
}: {
  group: RegionalGroupDto;
}): React.ReactElement | null => {
  const notes = noteRows(group);
  if (notes.length === 0) return null;
  return (
    <>
      <h3 className={styles.subheading}>From Wiktionary</h3>
      {notes.map((note) => (
        <blockquote
          key={`${note.char}-${note.section}`}
          className={styles.note}
          cite={note.url}
        >
          {note.paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          <footer className={styles.muted}>
            <span
              className={styles.noteChar}
              lang={note.lang}
              style={{ fontFamily: `"${note.family}"` }}
            >
              {note.char}
            </span>{" "}
            <a href={note.url}>{note.section} section on Wiktionary</a>
          </footer>
        </blockquote>
      ))}
      <p className={`${styles.credit} ${styles.muted}`}>
        Text from English Wiktionary, under{" "}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/">
          CC BY-SA 4.0
        </a>
        .
      </p>
    </>
  );
};
