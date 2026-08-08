import { useState } from "react";
import {
  ListBox,
  ListBoxItem,
  ToggleButton,
  ToggleButtonGroup
} from "react-aria-components";
import type { Key, Selection } from "react-aria-components";
import {
  inScript,
  KANA_CHART,
  type KanaScript,
  type KanaSection
} from "../../shared/kana-chart";
import { useNavigate } from "../navigation";
import styles from "./Browse.module.css";
import kanaStyles from "./KanaBrowse.module.css";

/**
 * The Kana tab (#55 step 3): the gojūon chart, in either script.
 *
 * No drill-down and no breadcrumb, unlike the Vocab and Kanji tabs — the chart IS the content, so
 * there is no second level to reach within the tab. Tapping a kana opens its STROKE ORDER, which is
 * a pushed view like any other detail page.
 *
 * Not a search: a single syllable is not a word, so searching one answers a question nobody asked.
 * A chart is a reference, and the one thing it can usefully take you deeper into is how the
 * character is written.
 *
 * The script is local state rather than machine context for the same reason a breadcrumb depth is:
 * the tab panels are force-mounted, so the toggle survives switching tabs on its own. It is
 * deliberately NOT persisted across a sidebar collapse — reopening on hiragana is a defensible
 * reset, and it is one toggle to undo.
 */
export const KanaBrowse = (): React.ReactElement => {
  const [script, setScript] = useState<KanaScript>("hiragana");
  return (
    <div className={styles.container}>
      <div className={kanaStyles.body}>
        <h1 className={styles.title}>Kana</h1>
        <ToggleButtonGroup
          className={kanaStyles.toggle}
          selectionMode="single"
          // `disallowEmptySelection` is what makes this a toggle rather than a pair of checkboxes:
          // there is no meaningful "neither script" state for the chart to render.
          disallowEmptySelection
          selectedKeys={new Set([script])}
          // `Selection` is `Set<Key> | "all"`, and "all" is unreachable for a single-selection
          // group — narrowing rather than asserting keeps that assumption checked instead of
          // spreading a value that may be a string.
          onSelectionChange={(keys: Selection) => {
            if (keys === "all") return;
            const next = keys.values().next().value;
            if (next === "hiragana" || next === "katakana") setScript(next);
          }}
        >
          <ToggleButton id="hiragana" className={kanaStyles.toggleButton}>
            Hiragana
          </ToggleButton>
          <ToggleButton id="katakana" className={kanaStyles.toggleButton}>
            Katakana
          </ToggleButton>
        </ToggleButtonGroup>
        {KANA_CHART.map((section) => (
          <ChartSection key={section.id} section={section} script={script} />
        ))}
      </div>
    </div>
  );
};

/**
 * One section of the chart as a grid.
 *
 * A `ListBox` with `layout="grid"`, matching the Kanji tab: React Aria then owns arrow-key movement
 * between cells, which is what a chart wants — you navigate it in two dimensions.
 *
 * The chart's gaps (や has no yi/ye, わ no wu) are NOT rendered as placeholder items. A ListBox's
 * children are a collection, so a filler `<div>` is not a thing it can hold, and a disabled item
 * would still be announced — a screen reader crossing the わ row would hear blank cells, which
 * describes our layout rather than the language. Instead each cell is placed explicitly with
 * `grid-column`, so the vowel columns line up because of where the real kana sit, and the gaps are
 * simply empty space.
 */
const ChartSection = ({
  section,
  script
}: {
  section: KanaSection;
  script: KanaScript;
}): React.ReactElement => {
  const { openStrokeOrder } = useNavigate();
  // Selection stays uncontrolled and inert; `onAction` is what fires on click and Enter, the same
  // arrangement the kanji grid and the search results use.
  const noop = (_: Selection): void => {};
  const items = section.rows.flatMap((row) =>
    row.cells.flatMap((cell, column) =>
      cell === undefined ? [] : [{ ...cell, column }]
    )
  );

  return (
    <section className={kanaStyles.section}>
      <h2 className={kanaStyles.sectionTitle}>{section.label}</h2>
      <ListBox
        aria-label={`${section.label} chart`}
        className={kanaStyles.grid}
        layout="grid"
        selectionMode="single"
        onSelectionChange={noop}
        // Tapping a kana opens its stroke order, NOT a search: a syllable on its own is not a word,
        // so searching one is a query with no useful answer. How it is written is the thing a chart
        // can actually take you deeper into.
        //
        // The item's key is the HIRAGANA, so a cell keeps its identity across the toggle; the
        // drawing opened is the DISPLAYED form, which is the one the user tapped.
        onAction={(key: Key) => openStrokeOrder(inScript(String(key), script))}
        // Digraphs have no drawing to open — きゃ is two code points and the host serves a drawing
        // by one-code-point filename, which upstream matches by having no combined file. Disabling
        // them is what stops a tap leading to an empty page.
        disabledKeys={items
          .filter((item) => Array.from(item.kana).length > 1)
          .map((item) => item.kana)}
        style={{
          gridTemplateColumns: `repeat(${section.columns.length}, 1fr)`
        }}
        items={items}
      >
        {(item) => (
          <ListBoxItem
            id={item.kana}
            // Both scripts' readings are in the accessible name because the romaji is how a learner
            // says the cell out loud, and typeahead should find き by typing "ki".
            textValue={`${inScript(item.kana, script)} ${item.romaji}`}
            className={
              item.obsolete === true
                ? `${kanaStyles.cell} ${kanaStyles.obsolete}`
                : kanaStyles.cell
            }
            style={{ gridColumn: item.column + 1 }}
          >
            <span className={kanaStyles.kana} lang="ja">
              {inScript(item.kana, script)}
            </span>
            <span className={kanaStyles.romaji}>{item.romaji}</span>
          </ListBoxItem>
        )}
      </ListBox>
    </section>
  );
};
