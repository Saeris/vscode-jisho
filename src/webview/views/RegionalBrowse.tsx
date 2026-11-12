import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
  Label,
  ListBox,
  ListBoxItem,
  ListLayout,
  SearchField,
  Input,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  ToggleButton,
  ToggleButtonGroup,
  Virtualizer,
  type Key,
  type Selection
} from "react-aria-components";
import type { RegionalGroupDto } from "../../shared/messages";
import {
  DEFAULT_FILTERS,
  FORM_COUNTS,
  LISTS,
  REGION_NAMES,
  SPLITS,
  filterRegional,
  splitLabel,
  type ListId,
  type RegionIndex,
  type RegionalFilters,
  type RegionalSort
} from "../../shared/regionalBrowse";
import { BrowseHeader } from "../components/BrowseHeader";
import { Overprint } from "../components/Overprint";
import { useNavigate } from "../navigation";
import { regionalBrowseQuery } from "../queries";
import {
  COLUMN_CODES,
  COLUMN_LANGS,
  codePointOf,
  columnNames,
  formRows,
  inkOf
} from "../regionalForms";
import styles from "./Browse.module.css";
import browse from "./RegionalBrowse.module.css";

const SORTS: ReadonlyArray<{ id: RegionalSort; label: string }> = [
  { id: "frequency", label: "Frequency" },
  { id: "strokes", label: "Strokes" },
  { id: "codePoint", label: "Code point" }
];

/** One row's height: the small overprint and the strip of forms beside it. */
const ROW_HEIGHT = 56;

/** The one key of a single selection, or undefined when nothing is selected. */
const only = (keys: Selection): string | undefined =>
  keys === "all" ? undefined : keys.values().next().value?.toString();

const isRegion = (value: number): value is RegionIndex =>
  value >= 0 && value <= 3;

/**
 * The Kanji tab's "Regional differences" list (spec 22, phase 7): every character group, filtered
 * by how the regions write it, the lists it is on, a stroke range and a search, and sorted by one
 * region's frequency, stroke count or code point. The whole table is held once and filtered here,
 * so a filter answers as fast as the reader changes it; the list renders only the rows in view.
 */
export const RegionalBrowse = ({
  onRoot
}: {
  onRoot: () => void;
}): React.ReactElement => {
  const { data, isPending } = useQuery(regionalBrowseQuery());
  const [filters, setFilters] = useState<RegionalFilters>(DEFAULT_FILTERS);
  // Typing stays responsive while the list catches up.
  const shown = useDeferredValue(filters);
  const groups = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => filterRegional(groups, shown), [groups, shown]);
  const update = (change: Partial<RegionalFilters>): void =>
    setFilters((previous) => ({ ...previous, ...change }));

  return (
    <>
      <BrowseHeader
        crumbs={[
          { label: "Kanji", onPress: onRoot },
          { label: "Regional differences" }
        ]}
        count={
          isPending
            ? undefined
            : `${rows.length.toLocaleString()} ${rows.length === 1 ? "character" : "characters"}`
        }
      />
      <Filters filters={filters} groups={groups} onChange={update} />
      {isPending ? (
        <p className={styles.note}>Loading…</p>
      ) : (
        <Results rows={rows} filters={shown} />
      )}
    </>
  );
};

/** How many of the filters behind the disclosure differ from their defaults. */
const changedFilters = (filters: RegionalFilters): number =>
  [
    filters.pattern !== DEFAULT_FILTERS.pattern,
    filters.region !== DEFAULT_FILTERS.region,
    filters.sort !== DEFAULT_FILTERS.sort,
    filters.strokes !== null,
    filters.lists.length > 0
  ].filter(Boolean).length;

const Filters = ({
  filters,
  groups,
  onChange
}: {
  filters: RegionalFilters;
  groups: readonly RegionalGroupDto[];
  onChange: (change: Partial<RegionalFilters>) => void;
}): React.ReactElement => {
  const { pattern, region } = filters;
  // A split names its count of forms, so the count's chip stays selected under it.
  const count = pattern.length === 4 ? String(new Set(pattern).size) : pattern;
  const splits = SPLITS.filter(
    (signature) => String(new Set(signature).size) === count
  );
  const maxStrokes = useMemo(
    () => Math.max(1, ...groups.map((g) => g.strokes[region] ?? 0)),
    [groups, region]
  );
  const range = filters.strokes ?? [1, maxStrokes];
  const changed = changedFilters(filters);

  return (
    <div className={browse.filters}>
      <SearchField
        className={browse.search}
        aria-label="Search the regional forms"
        value={filters.search}
        onChange={(search) => onChange({ search })}
      >
        <Input
          className={browse.input}
          placeholder="Character, reading or U+5B66"
        />
      </SearchField>
      <Disclosure className={browse.more}>
        <Heading className={browse.moreHeading}>
          <Button slot="trigger" className={browse.moreTrigger}>
            <span aria-hidden="true" className={browse.moreChevron}>
              ›
            </span>
            Filters
            {changed > 0 ? ` (${changed})` : ""}
          </Button>
        </Heading>
        <DisclosurePanel className={browse.morePanel}>
          <ToggleButtonGroup
            aria-label="Number of forms"
            className={browse.chips}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([count])}
            onSelectionChange={(keys) =>
              onChange({ pattern: only(keys) ?? "any" })
            }
          >
            {FORM_COUNTS.map((option) => (
              <ToggleButton
                key={option.id}
                id={option.id}
                className={browse.chip}
              >
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {splits.length > 0 ? (
            <ToggleButtonGroup
              aria-label="Which regions differ"
              className={browse.chips}
              selectionMode="single"
              selectedKeys={new Set(pattern.length === 4 ? [pattern] : [])}
              onSelectionChange={(keys) =>
                onChange({ pattern: only(keys) ?? count })
              }
            >
              {splits.map((signature) => (
                <ToggleButton
                  key={signature}
                  id={signature}
                  className={browse.chip}
                >
                  {splitLabel(signature)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : null}
          <ToggleButtonGroup
            aria-label="Region"
            className={browse.chips}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([String(region)])}
            onSelectionChange={(keys) => {
              const next = Number(only(keys));
              // The range was set in the old region's counts, so it does not carry over.
              if (isRegion(next)) onChange({ region: next, strokes: null });
            }}
          >
            {REGION_NAMES.map((name, index) => (
              <ToggleButton
                key={name}
                id={String(index)}
                className={browse.chip}
              >
                {name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <p className={browse.hint}>
            The sort and the stroke range read this region.
          </p>
          <ToggleButtonGroup
            aria-label="Sort by"
            className={browse.chips}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([filters.sort])}
            onSelectionChange={(keys) => {
              const next = SORTS.find((sort) => sort.id === only(keys));
              if (next) onChange({ sort: next.id });
            }}
          >
            {SORTS.map((sort) => (
              <ToggleButton key={sort.id} id={sort.id} className={browse.chip}>
                {sort.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Slider
            className={browse.slider}
            value={[...range]}
            minValue={1}
            maxValue={maxStrokes}
            onChange={(value) => strokesChanged(value, maxStrokes, onChange)}
            onChangeEnd={(value) => strokesChanged(value, maxStrokes, onChange)}
          >
            <div className={browse.sliderHeader}>
              <Label>Strokes in {REGION_NAMES[region]}</Label>
              <SliderOutput className={browse.sliderValue}>
                {({ state }) =>
                  `${state.getThumbValue(0)}–${state.getThumbValue(1)}`
                }
              </SliderOutput>
            </div>
            <SliderTrack className={browse.sliderTrack}>
              {({ state }) => (
                <>
                  <div
                    className={browse.sliderFill}
                    style={{
                      insetInlineStart: `${state.getThumbPercent(0) * 100}%`,
                      insetInlineEnd: `${(1 - state.getThumbPercent(1)) * 100}%`
                    }}
                  />
                  <SliderThumb
                    index={0}
                    aria-label="Fewest strokes"
                    className={browse.sliderThumb}
                  />
                  <SliderThumb
                    index={1}
                    aria-label="Most strokes"
                    className={browse.sliderThumb}
                  />
                </>
              )}
            </SliderTrack>
          </Slider>
          <ToggleButtonGroup
            aria-label="On the lists"
            className={browse.chips}
            selectionMode="multiple"
            selectedKeys={new Set(filters.lists)}
            onSelectionChange={(keys) =>
              onChange({
                lists: LISTS.filter((list) => keys.has(list.id)).map(
                  (list): ListId => list.id
                )
              })
            }
          >
            {LISTS.map((list) => (
              <ToggleButton key={list.id} id={list.id} className={browse.chip}>
                {list.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </DisclosurePanel>
      </Disclosure>
    </div>
  );
};

/** The full range is no filter at all, so forms no source counts stay in the list. */
const strokesChanged = (
  value: number | number[],
  max: number,
  onChange: (change: Partial<RegionalFilters>) => void
): void => {
  if (!Array.isArray(value)) return;
  const [low = 1, high = max] = value;
  onChange({ strokes: low === 1 && high === max ? null : [low, high] });
};

/** The sorted value, at the row's end, so the order explains itself. */
const sortedBy = (
  group: RegionalGroupDto,
  filters: RegionalFilters
): string => {
  const { region } = filters;
  if (filters.sort === "codePoint")
    return codePointOf(group.chars[region] ?? "");
  const value =
    (filters.sort === "frequency"
      ? group.ranks[region]
      : group.strokes[region]) ?? null;
  if (value === null) return "";
  return filters.sort === "frequency"
    ? `#${value.toLocaleString("en")}`
    : `${value} strokes`;
};

const Results = ({
  rows,
  filters
}: {
  rows: RegionalGroupDto[];
  filters: RegionalFilters;
}): React.ReactElement => {
  const { openRegionalForms } = useNavigate();
  // ListBox opens on Enter via onAction; selection stays uncontrolled like the other lists.
  const noop = (_: Selection): void => {};
  return (
    <Virtualizer layout={ListLayout} layoutOptions={{ rowSize: ROW_HEIGHT }}>
      <ListBox
        aria-label="Regional differences"
        className={browse.results}
        selectionMode="single"
        onSelectionChange={noop}
        onAction={(key: Key) => {
          const group = rows.find((row) => row.key === key);
          if (group) openRegionalForms(group.chars[3] ?? group.key);
        }}
        items={rows}
        dependencies={[filters.sort, filters.region]}
        renderEmptyState={() => (
          <p className={styles.note}>No characters match these filters.</p>
        )}
      >
        {(group) => <ResultRow group={group} filters={filters} />}
      </ListBox>
    </Virtualizer>
  );
};

/** A small overprint, then each distinct form with the regions that write it. */
const ResultRow = ({
  group,
  filters
}: {
  group: RegionalGroupDto;
  filters: RegionalFilters;
}): React.ReactElement => {
  const forms = formRows(group);
  return (
    <ListBoxItem
      id={group.key}
      textValue={group.chars[3] ?? group.key}
      className={browse.result}
      aria-label={forms
        .map((row) => `${row.char}, ${columnNames(row.columns)}`)
        .join("; ")}
    >
      <Overprint
        rows={forms}
        size="row"
        name={`regional-browse-${group.key}`}
      />
      <span className={browse.strip}>
        {forms.map((row, index) => (
          <span
            key={`${row.char}-${row.columns.join("")}`}
            className={browse.form}
            style={{ "--ink": inkOf(index) }}
          >
            <span
              className={browse.formChar}
              lang={COLUMN_LANGS[row.columns[0] ?? 3]}
              style={{ fontFamily: `"${row.family}"` }}
            >
              {row.char}
            </span>
            <span className={browse.formRegions}>
              {row.columns.map((column) => COLUMN_CODES[column]).join(" ")}
            </span>
          </span>
        ))}
      </span>
      <span className={browse.value}>{sortedBy(group, filters)}</span>
    </ListBoxItem>
  );
};
