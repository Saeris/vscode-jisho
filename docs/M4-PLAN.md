# Milestone 4 Plan — Kanji as first-class

> **Status:** planned. Add the character half of the dictionary: kanji appear in search results as their own section, get a full detail view with radical breakdown, and cross-link with vocabulary. Read [CONVENTIONS.md](CONVENTIONS.md) first.

## Context

Searching 食 today returns vocabulary _containing_ 食 (via `char` term rows) but nothing about the character itself. Shirabe and jisho.org treat words and kanji as distinct result types shown together. Two new datasets power this, both from the same jmdict-simplified release the data build already consumes (same `RELEASE_API`, new asset patterns): **Kanjidic2** (`kanjidic2-en-*.json`, ~15MB — readings, meanings, stroke count, grade, JLPT level, frequency) and **Kradfile/Radkfile** (kanji→components and radical→kanji maps). TypeScript types for all of them already exist in the installed `@scriptin/jmdict-simplified-types` (see `Kanjidic2Character`, `Kradfile`, `Radkfile`).

Licensing: Kanjidic is **CC BY-SA 4.0**; KRADFILE/RADKFILE are EDRDG-licensed (RADKFILE2/KRADFILE2 © Jim Rose). Attribution additions are part of item 1, not an afterthought.

## 1. Datasets → schema + data build

New tables in `src/data/schema.sql` (shapes are a starting point — adjust to what rendering actually needs):

- `kanji_characters(literal PK, grade, stroke_count, frequency, jlpt, on_json, kun_json, meanings_json, nanori_json)` — from Kanjidic2's `readingMeaning.groups` (readings typed `ja_on`/`ja_kun`; ignore pinyin/korean/vietnam) + `misc`. Note `misc.strokeCounts[0]` is the accepted count.
- `kanji_components(literal, component)` — from Kradfile's `kanji` map (one row per component).
- `radicals(radical PK, stroke_count, kanji_json)` — from Radkfile (drives item 4's radical picker; `kanji_json` as a JSON array is fine — it's read whole, never joined).
- New `search_terms` kinds for kanji-as-a-result: `kanji_literal` (the character, exact match) and `kanji_meaning` (each meaning word, lowercased — mirror how `word` rows are built for glosses). Keeping these as distinct kinds keeps the vocabulary ranking CASE untouched.

Data build: add the two asset patterns + import passes to `scripts/build-data.ts`. Kanjidic has ~13k characters and Kradfile ~12k entries — minutes at most with the existing batching. Both build variants include kanji data (it's small); rebuild both and refresh `dictionary-latest` per CONVENTIONS. Extend `meta` (kanjidic version/date) + About view + README attribution in the same commit.

**Success:** a db.spec test resolves 食 → grade 2, stroke count 9, on-reading ショク, meaning "eat"; a kradfile test resolves 働 → components including 人/動; both variants build clean.

## 2. Kanji in search results

Search returns two sections. Extend the contract: `SearchResponse` gains `kanji: KanjiResultDto[]` (`literal`, `strokeCount`, `grade`, `jlpt`, `meaningPreview`, `onPreview`, `kunPreview`). Host: a second query in `Dictionary.search` (or a sibling `searchKanji`) against the new kinds — exact `kanji_literal` hit for CJK queries (any character of the query when multi-char), exact/prefix `kanji_meaning` for latin queries. Cap the section (~5). Keep it index-friendly.

Webview: `SearchResults` renders a "Kanji" section above/below "Words" (Shirabe shows kanji after words; match that). Each kanji row opens the kanji detail (item 3). Update the bridge/query typing; the response stays clone-safe.

**Success:** searching 食 or "eat" shows a Kanji section (食) alongside word results; searching たべる shows none (kana queries have no kanji section); db tests cover both routes.

## 3. Kanji detail view + cross-navigation

- Navigation machine: `View` union gains `{ name: "kanjiDetail"; literal: string }` + an `openKanji` event (mirror `openWord`; the stack design absorbs it — this was anticipated in M1).
- New message pair `getKanji(literal)` → readings, meanings, nanori, grade/stroke/frequency/JLPT, components (joined with each component's own kanjidic meta when it is itself a kanji), and **common words containing it** (existing `char` term rows: `kind='char' AND term=?` ordered `is_common DESC`, limit ~10 — already indexed).
- `KanjiDetail.tsx`: header (large literal + grade/JLPT/strokes badges — reuse the CVA `Badge`), readings (on/kun/nanori), meanings, components (each tappable → that component's kanji detail), common words (tappable → word detail). Back pops as everywhere.
- Cross-navigation from vocabulary: in `WordDetail`, render each CJK character of the headword as a tappable affordance (the M2 xref link treatment) dispatching `openKanji`.

**Success:** machine tests for `openKanji` push/pop; F5: search 食べる → open word → tap 食 → kanji detail with readings/components/common-words → tap a common word → word detail → Back chain unwinds correctly.

## 4. Radical-based lookup (separable — slips to M7 if the milestone runs long)

Shirabe's "Radicals" search mode: a grid of radicals grouped by stroke count (from `radicals`); selecting radicals narrows to kanji containing **all** of them (intersect `kanji_components`), displayed with their kanjidic meta; tapping one opens kanji detail or inserts the literal into the search box. New machine view + a `getRadicals`/`lookupByRadicals` message pair. Selection state is UI state → machine context (or local state if it never needs to survive navigation).

## Build order & verification

1 (data) → 2 (results section) → 3 (detail + cross-nav) → 4 (radical lookup, optional). Per-item commits + bump files (item 1 is `minor`). Standing gates per CONVENTIONS; latency re-probe after item 1 (new rows change table size; expect no regression since all new lookups are exact/prefix). F5 pass for the UI items. Append as-built deviations + flip ROADMAP status when done.
