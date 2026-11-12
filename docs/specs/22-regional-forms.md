# Spec 22 — Regional forms: one kanji across Japan, China, Hong Kong and Taiwan

> **Status:** phase 0 (spikes) done on 2026-11-10; phases 1 (data), 2 (fonts), 3 (the view), 4 (stroke order), 5 (readings and frequency), 6 (Wiktionary notes) and 7 (browse and filters) built, with their results recorded below. The phases ship as one stack of pull requests, released together. Decisions made with the user on 2026-11-10 (see "Decisions"). **Backlog:** #56. **Based on** a study of [hanji](https://github.com/sxzz/hanji) (code MIT, compiled data CC BY 4.0) on 2026-11-10: its live site, explored with Playwright, and its source at commit `f0ae600`. hanji is a **reference, not a template**: port what fits our setup, adapt the rest, and do not copy it one for one.

## Why

A kanji you meet outside a Japanese textbook is often not the form Japan writes. Chinese text uses simplified or traditional forms; signs, names and older books use the forms Japan wrote before its postwar reform (kyūjitai, "old forms"). Sometimes the difference is a different character with its own code point (学 in Japan, 學 in Taiwan). Sometimes it is the same code point drawn differently: 返 is one Unicode character, but China, Japan, Hong Kong and Taiwan each draw it slightly differently, most visibly in its "movement" radical (shinnyō).

The user wants to fold most of hanji into our kanji pages so that a learner can:

- see how each region writes a kanji, stacked on top of one another so the differences stand out;
- compare code points, stroke counts and official list status in one chart;
- watch the stroke order each region teaches;
- read how the character is pronounced elsewhere, how common it is in each region, and where its shape came from;
- search and filter the whole table of regional differences;
- later, take a form seen in the wild and find the Japanese kanji it corresponds to.

## Decisions (2026-11-10)

1. **Port and adapt** hanji's method into our data build, with hanji's code as a reference. Do not ship hanji's published data.
2. **Taiwan's list status comes from Taiwan's own sources**, preferably (see "Taiwan's list" under Data: the cleanest licensed source is still to be found).
3. **Korea is out for now.** It overlaps least with Japanese. Regions: China (CN), Japan (JP), Japan's old form (Old), Hong Kong (HK), Taiwan (TW).
4. **Fonts are bundled** in the `.vsix`.
5. **Lookup from a regional form comes later** in development, after the rest of this spec.
6. **Readings in other languages and frequency per region are in scope** (phase 5).
7. **Wiktionary is an added source** (user's suggestion): its character pages give variant forms, where a shape came from, and definitions and readings in English for each language (phase 6).
8. **China's frequency uses Jun Da's list, with credit** (2026-11-12), although it states no licence; see phase 5's results.

## What hanji does

### The character page

From top to bottom, for a character such as 晚 (China, Hong Kong, Taiwan) / 晩 (Japan):

1. **The stacked comparison ("overprint").** Each distinct form is drawn as its own layer, in its region's font, at the same size and position. Each layer gets one of five inks of equal lightness that differ only in hue, at roughly 30–40% fill with a thin outline, blended with `darken` on light paper and `lighten` on dark paper. Strokes the forms share pile up into a darker shape; strokes only one form has stay in that form's ink.
2. **The comparison chart.** One column per region: China (CN), Japan (JP), Japan's old form ("Old", shown only when Japan writes a reformed shinjitai), Hong Kong + Taiwan (HK TW). Rows: the glyph in that region's font, Unicode code point, stroke count, frequency rank, and list status (for example "Kyōiku kanji" for Japan, "Level 1" of China's 2013 table, "Commonly used character" in Hong Kong and Taiwan). **Cells merge across regions that agree**: when Hong Kong, Taiwan and the old Japanese form share U+665A, that cell spans all three. A summary line follows: "2 distinct glyphs".
3. **Readings** in Mandarin, Cantonese, Japanese on'yomi and kun'yomi, and Korean.
4. **Stroke order** (from AnimCJK, the data we already use), with one button per distinct drawing. Regions that draw the same strokes share a button ("CN HK TW", "JP", "Old"). A stroke grid shows every stroke step with a red dot at each stroke's start, beside a player with play, step and speed controls.
5. **External dictionaries** for each distinct form.

Each column header carries a checkbox: unchecking a region removes its column and regroups the rest.

### The list page: search and filters

- A hero overprint of a featured character with a one-line summary ("4 distinct glyphs: Mainland China, Japan, Hong Kong and Taiwan all use different glyphs"), a **Separate / Overprint** toggle that switches between the stack and the forms side by side with region labels, and a link to the details. Clicking the hero glyph lets you type another character.
- **Search** by character, reading, or code point (`U+9AD8`).
- **Stroke count range** (1–36) for a chosen region.
- **Used in**: toggle regions.
- **Sort by** frequency, stroke count or code point, each for a chosen region's corpus.
- **Listed in**: China's levels 1–3, jōyō kanji, kyōiku kanji, Japanese old forms, Hong Kong common characters, Taiwan common and less-common characters.
- **Compare by** glyph or by code point.
- **Difference pattern**: counts for "same glyph in all regions" and for 2, 3 and 4 distinct forms, then one chip for each exact way the regions split into two or three forms (13 of them for four regions), each drawn as coloured bars.
- **Results**: one row per character with a small overprint, each region's glyph and code point, and coloured underlines that group the regions writing it the same way.

### Interactions worth keeping

- **Rest the pointer on a stack** and its layers fan apart by about 3 px, then each form lights up in turn.
- **Press and drag** across a stack to pull the layers apart sideways; on release they spring back into register with a slight overshoot.
- **Outline mode** (a display option) drops the fill and keeps only outlines, which reads better on dense characters.
- The fill fades as stroke count rises (0.42 below 10 strokes, down to 0.24 at 20 or more) so complex stacks do not turn into a dark block.
- Text in a stack is not selectable: dragging across four stacked forms would otherwise select four copies of the character.

### At sidebar width

At 380 px the page mostly survives: a three-column chart fits, but the readings table runs off the right edge and five columns would not fit. Our sidebar is usually 300–400 px wide, so the chart needs a layout of its own (see "The comparison chart in a narrow sidebar").

### How the data is made

- **Scope.** The union of five official lists: China's Table of General Standard Chinese Characters (2013), Taiwan's Standard Form of National Characters (1982), Hong Kong's List of Graphemes of Commonly-Used Chinese Characters, Japan's jōyō kanji (2010), and South Korea's Basic Hanja for Educational Use (2000). Forms that are the same character in different regions (simplified and traditional, Japanese reformed and old forms) are merged with OpenCC's variant tables into one row per character: 8,449 rows. 1,692 are written the same way everywhere; 129 differ in all five regions.
- **Glyph identity** ([`scripts/cmap.ts`](https://github.com/sxzz/hanji/blob/main/scripts/cmap.ts)). Adobe's Source Han fonts draw every region from one shared pool of glyphs, with a per-region map from code point to glyph ID (CID). Two regions write a character the same way exactly when their maps give the same glyph ID. No outlines are compared. hanji does this for both the sans and the serif family and treats two regions as the same if **either** family gives them one glyph, so a difference only one typeface makes (a design choice, not a regional convention) is ignored.
- **The partition signature.** Each row stores its regions' glyph IDs as a string numbered in order of first appearance: `"0000"` when all agree, `"0112"` when the first stands alone, the middle two agree and the last differs. The same is done for code points. Every filter, chip and grouping on the site reads these two strings.
- **Stroke counts** come first from the stroke-order data (the number of strokes actually drawn), then from Unihan (`kAlternateTotalStrokes`, `kRSAdobe_Japan1_6`, `kTotalStrokes`).
- **Frequency** comes from a different corpus per region (Chinese text, written Cantonese, Taiwanese news and forums, Japanese Wikipedia).
- **The build** is about 1,100 lines ([`scripts/build-data.ts`](https://github.com/sxzz/hanji/blob/main/scripts/build-data.ts)), most of it reconciling OpenCC with the official lists: folding rows that name the same character, keeping apart characters a region lists separately, and flagging relations the lists do not confirm.

### Fonts

The display uses Noto Sans CJK in each regional version (SC for China, TC for Taiwan, HK, JP, KR), subset to the characters in the table. Two tricks keep it small: regions that write a character the same way share one region's glyph, so the others do not carry it (about a third fewer glyphs, and the cells shown as identical really are one glyph); and each font is split by Unicode range in order of commonness, so the browser loads only the pieces on screen. **Measured: 5.37 MB for the sans fonts of all five regions** (China 1.96, Hong Kong 1.51, Japan 1.38, Taiwan 0.35, Korea 0.17), so about 5.2 MB without Korea.

### Stroke order

hanji reads AnimCJK's per-language data: Simplified Chinese for China, Traditional Chinese for Taiwan, Japanese, and Korean. Hong Kong (and the old Japanese form) borrow the drawing of a region that writes the same glyph. When two regions' ordered strokes are identical, only one drawing is stored. **Coverage is uneven** (AnimCJK at hanji's pinned commit):

| AnimCJK set         | Characters | Size    |
| ------------------- | ---------- | ------- |
| Japanese            | 7,007      | 21.9 MB |
| Simplified Chinese  | 8,014      | 22.6 MB |
| Traditional Chinese | 1,013      | 3.0 MB  |
| Korean (not needed) | 535        | 1.4 MB  |

So Taiwan and Hong Kong will have no drawing for most characters, which is why hanji's page for 返 offers only China and Japan.

### Licences and names

- **Code: MIT.** Where we port code, keep its copyright notice.
- **Compiled data** (the row structure, selection and arrangement): **CC BY 4.0**. We are not shipping it (decision 1), but if any of it is ever used: "Hanji data by Kevin Deng, CC BY 4.0, https://github.com/sxzz/hanji".
- **Third-party data** keeps its own licence (table under "Sources and licences").
- **The name "Hanji" and its logo are excluded from both licences.** We may not use them as the name of our feature. A plain credit such as "based on Hanji" in our notices is allowed.
- **One source has no licence:** hanji takes the five official lists from a transcription (`zispace/hanzi-chars`) whose repository states none. We do not use it.

## What we adopt, adapt and leave out

| hanji feature                                       | For jisho                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Glyph identity from Source Han CMaps (sans ∪ serif) | **Adopt**: small, exact, licence-clean                                                                                  |
| Row building (OpenCC + lists)                       | **Adapt** into our build, tested against hanji's output                                                                 |
| Overprint stack and its interactions                | **Adopt**, with our theme tokens and a non-colour channel                                                               |
| Comparison chart with merged cells                  | **Adapt** for a narrow sidebar                                                                                          |
| Stroke order per region                             | **Adopt**, on our existing stroke player                                                                                |
| Region fonts, subset and shared by group            | **Adopt**                                                                                                               |
| Readings in other languages                         | **Adopt** (Mandarin, Cantonese); Korean is out with Korea                                                               |
| Frequency per region                                | **Adopt**, from sources whose terms suit us                                                                             |
| Search and filters                                  | **Adapt** into the Kanji browse tab                                                                                     |
| External dictionary links                           | **Adapt**: English-language ones only (Wiktionary, the Unicode Unihan page), since most of hanji's are Chinese-language |
| Korea                                               | **Leave out for now** (decision 3)                                                                                      |
| Interface languages, serif typeface, PWA, OG images | **Leave out**                                                                                                           |
| The name and logo                                   | **Leave out** (not licensed)                                                                                            |
| _(not in hanji)_ Wiktionary                         | **Add**: shape history, definitions and readings in English, and a cross-check of our grouping                          |

## Design for jisho

### Where it lives

- **A summary on the kanji page.** When a kanji has regional forms that differ, KanjiDetail gets a compact block under the readings: a small overprint, a line such as "Written differently in China and Taiwan · 3 forms", and a button into the full view. When every region writes it the same way, a single quiet line says so.
- **A "Regional forms" view.** Opened from that block, the same way the stroke-order and component-tree views open today: the overprint, the chart, stroke order by region, readings and frequency, the Wiktionary notes, and links.

### The overprint

Ported from hanji with its behaviours (fan on rest, highlight each form in turn, press-and-drag to separate, spring back, outline mode, the Separate/Overprint toggle). Changes for us:

- **Inks from our theme.** Hues at equal lightness, derived in oklch from the theme's foreground per [CONVENTIONS.md](../CONVENTIONS.md), with the light-theme value under `body.vscode-light` (not `prefers-color-scheme`). Blend with `darken` on light themes and `lighten` on dark ones. Verify contrast on both themes in the E2E captures.
- **Not by colour alone.** The inks differ only in hue, which fails readers with colour-vision deficiencies (our POS palette treats that as a requirement). The forms must also be told apart by label: the Separate view labels each form with its regions, the highlight cycle names the form it lights, and the chart below names everything.
- **Reduced motion.** With `prefers-reduced-motion`, no fan or spring: Separate is a plain switch.
- Follow [STROKE-ORDER.md](../STROKE-ORDER.md)'s lessons for anything animated (one clock, registered `@property`).

### The comparison chart in a narrow sidebar

hanji's grid of one column per region needs width we do not have. Instead, **one row per distinct form**, which is also how a learner reads it ("which forms exist, and who uses each"):

| Form | Used in                             | Code point | Strokes | Lists                         |
| ---- | ----------------------------------- | ---------- | ------- | ----------------------------- |
| 学   | China, Japan                        | U+5B66     | 8       | China level 1 · Kyōiku kanji  |
| 學   | Taiwan, Hong Kong, Japan's old form | U+5B78     | 16      | Common characters (HK and TW) |

When two rows share a code point, the chart says so ("same code point, drawn differently"), since that is exactly the case a learner cannot see from the code point alone: 返 would show four rows, all U+8FD4. Where the view is wide enough (container query), it may switch to hanji's region columns.

### Stroke order by region

The existing stroke-order view gains a region switcher above the player, one choice per distinct drawing ("Japan", "China", "Taiwan · Hong Kong", "Old"). A region with no drawing says so plainly ("No stroke-order data for Taiwan's form") instead of falling back silently to another region's order, because a different order is exactly what the learner is checking.

### Readings and frequency

The view lists Mandarin and Cantonese readings beside our Japanese ones, and each region's frequency rank. Frequency ranks come from different corpora (news, forums, an encyclopedia), so the view labels each rank with its region and corpus, and never compares them as one scale.

### Where the shape came from (Wiktionary)

A short "From Wiktionary" block: the cross-language note on the character's forms (for example, that 学 was simplified from 學) and, where Wiktionary has one, its "glyph origin" note, with a link to the page and the CC BY-SA credit. Simplified pages on Wiktionary often only point at the traditional form ("see 學"), so the build takes the note from the traditional form's page when the simplified one has none.

### Browse and filters

The Kanji browse tab gains a "Regional differences" list with hanji's filters, adapted: search (character, reading, code point), difference pattern (same everywhere, 2/3/4 forms, then the exact split chips), list membership, stroke-count range for a chosen region, sort by stroke count, code point or a region's frequency. Each result row: a small overprint, then the forms in a compact strip grouped by region.

## Data

### Scope

All character groups in the union of the four regions' official lists (China, Hong Kong, Taiwan, Japan). The set is small (hanji's whole JSON, with Korea, is 3.1 MB, 430 KB gzipped), and including groups whose Japanese form is unlisted keeps the later lookup phase possible. The kanji page shows the block only for groups whose Japanese form is in our `kanji_characters`.

### Sources and licences

| Use                                        | Source                                                                                                                                                  | Licence                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Whether regions share a glyph              | Adobe Source Han Sans and Serif, region CMaps (8 small files for four regions)                                                                          | SIL OFL 1.1                                                |
| Display fonts                              | Noto Sans CJK SC, TC, HK, JP, subset and renamed                                                                                                        | SIL OFL 1.1                                                |
| Which forms belong together                | OpenCC variant tables                                                                                                                                   | Apache-2.0                                                 |
| China, Japan and Hong Kong list membership | Unihan: `kTGH` (China 2013 table, with its three levels by index: 1–3,500, 3,501–6,500, 6,501–8,105), `kJoyoKanji` (its `2010` values only), `kHKGlyph` | Unicode License v3                                         |
| Taiwan list membership                     | CNS 11643 open data (`CNS_source.txt`, mapped by its Unicode tables): see "Taiwan's list" below                                                         | Open Government Data License 1.0 (attribution)             |
| Kyōiku grade                               | Kanjidic2 (already in our DB)                                                                                                                           | CC BY-SA 4.0 (already attributed)                          |
| Stroke counts                              | Taiwan: CNS 11643. Japan: Kanjidic2, as on the kanji page. China: Unihan (phase 4's drawings may refine it). Hong Kong: a region drawing the same glyph | OGDL 1.0 / CC BY-SA 4.0 / Unicode License v3               |
| Stroke order                               | AnimCJK: Simplified and Traditional Chinese sets, in addition to our Japanese set                                                                       | Arphic Public License (already shipped and noted)          |
| Mandarin and Cantonese readings            | Unihan `kMandarin`, `kCantonese`                                                                                                                        | Unicode License v3                                         |
| Frequency, China                           | Jun Da's Modern Chinese Character Frequency List (via hanziDB)                                                                                          | © Jun Da, no licence stated; used with credit (decision 8) |
| Frequency, Hong Kong                       | words.hk corpus character frequency                                                                                                                     | Public domain (credit requested)                           |
| Frequency, Taiwan                          | National Academy for Educational Research, corpus character frequency (2023)                                                                            | Open-data declaration, attribution required                |
| Frequency, Japan                           | scriptin/kanji-frequency (Japanese Wikipedia), beyond Kanjidic2's newspaper top 2,500                                                                   | CC BY 4.0                                                  |
| Shape history, definitions, cross-check    | English Wiktionary, via Wiktextract's extraction ([kaikki.org](https://kaikki.org/dictionary/rawdata.html))                                             | CC BY-SA 4.0                                               |
| The method, and any ported code            | hanji                                                                                                                                                   | MIT (keep the notice)                                      |

Taking list membership from Unihan avoids the unlicensed transcription hanji uses. Every frequency source and Wiktionary need a line in THIRD_PARTY_NOTICES, and Wiktionary text needs a credit and link where it is shown.

### Taiwan's list

Unihan has no field for Taiwan's Standard Form of National Characters (4,808 common characters, plus a secondary list). What was found on 2026-11-10:

- **The Ministry of Education** publishes the 4,808-character list as an ODS spreadsheet and a PDF on its [language portal](https://language.moe.gov.tw/material/info?m=9fe3ff5a-5a8c-4817-9e60-6337dd55a509). The page states no open licence; its footer says "Copyright All Rights Reserved". Taiwan's copyright law exempts official government documents, and which characters a list contains is arguably a fact rather than a work, but that is not ours to conclude without checking.
- **CNS 11643** (Taiwan's national character database, on Taiwan's [open data portal](https://data.gov.tw/dataset/5961)) is under the Open Government Data License 1.0, which allows reuse with attribution. Its attribute data covers stroke counts, stroke order, readings, radicals and components. Whether it records membership of the 4,808 list is not stated.

**Settled in phase 0: CNS 11643.** Its `CNS_source.txt` (in `Properties.zip`) records, for each character, the documents it comes from, and those include the Ministry's own lists. Mapped to Unicode through the database's own mapping tables (`MapingTables.zip`, same licence), with no code left unmapped:

| List (translated)                                | Characters                                     |
| ------------------------------------------------ | ---------------------------------------------- |
| Standard Form of Common National Characters      | 4,808, the list's official size                |
| Standard Form of Less-Common National Characters | 6,355 (the official list has 6,341): see below |
| Standard Form of Rare National Characters        | 18,357 (not needed)                            |

The gap in the less-common list, found in phase 1: `CNS_source.txt` names **one** document per character, the first that attests it, not every list that includes it. The common list comes out whole, but about 580 less-common characters are credited to the list of common characters in primary and junior-high textbooks instead (喫 among them). The less-common list is therefore the less-common source (5,768) plus the textbook source (587): 6,355 against the official 6,341, so at most 14 textbook characters are marked less-common wrongly. Of the 2,744 less-common forms hanji shows, this covers 2,743.

CNS 11643 rebuilds an archive whenever any file in it changes, at the same URL and not always with a new version in its `release.txt` (`Properties.zip` named 20261028 and was modified on 2026-11-04). A checksum pin would fail the data build every few weeks, so the build takes the latest, records each archive's date in `meta`, and fails if the common list is not exactly 4,808.

Spot checks pass: 學, 返, 有, 晚 and 國 are common; 学, 晩 and 国 (simplified or Japanese forms) are on neither list. The same data gives Taiwan's stroke counts (`CNS_stroke.txt`) and Taiwan's stroke order as a sequence of stroke types (`CNS_strokes_sequence.txt`: 1 horizontal, 2 vertical, 3 left-falling, 4 dot, 5 turning). That sequence cannot be animated, but it can check Taiwan's stroke count and order where AnimCJK has no Traditional Chinese drawing. Attribution, as the licence requires: "CNS 11643 Chinese Standard Interchange Code, National Development Council, Taiwan (Open Government Data License 1.0)".

### Wiktionary extraction

kaikki.org publishes English Wiktionary as JSON Lines, extracted weekly. The per-language files are deprecated and due to be removed, so the build cannot rely on them. The full dump is 24.8 GB (2.9 GB compressed): too heavy for every data build. Instead, an **on-demand extraction job** streams the full dump once, keeps the single-character entries of the Translingual, Chinese and Japanese sections, and publishes the small result as a release asset that the data build pins by tag and checksum. Re-run it when we want fresher notes. Measured in phase 0: 141 seconds for the full dump, and an 18.8 MB result. (kaikki.org asks users to cite its LREC 2022 paper; credit it in THIRD_PARTY_NOTICES.)

### Schema (schema 8)

As built in phase 1 (comments shortened; `src/data/schema.sql` has them in full):

```sql
-- One character, as the regions write it (hanji's "row").
CREATE TABLE regional_groups (
  id        INTEGER PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE, -- the group's name, usually its traditional form
  glyph_sig TEXT NOT NULL,        -- partition of (cn, hk, tw, jp[, old]) by glyph, e.g. '0010'
  cp_sig    TEXT NOT NULL         -- the same over (cn, hk, tw, jp), by code point
);

-- One row per region, plus 'old' for Japan's pre-reform form.
CREATE TABLE regional_forms (
  group_id INTEGER NOT NULL REFERENCES regional_groups(id),
  region   TEXT NOT NULL,         -- 'cn' | 'hk' | 'tw' | 'jp' | 'old'
  char     TEXT NOT NULL,
  strokes  INTEGER,               -- NULL when no source counts the form
  tier     INTEGER NOT NULL,      -- list level in this region (0 = unlisted, and always for 'old')
  PRIMARY KEY (group_id, region)
) WITHOUT ROWID;

CREATE INDEX idx_regional_forms_char ON regional_forms(char);  -- the later lookup phase
```

The proposal's other columns are left out. A form's glyph is its digit in `glyph_sig`, so a `glyph` column would repeat it. hanji's `listing` (primary or glossed) has no counterpart in our sources. `notes`, `freq` and `drawing` belong to phases 4–6, which add them with their data. Each change bumps `SCHEMA_VERSION` again and publishes to its own `dictionary-v{N}`; only the schemas a release ships are rebuilt for good (`scripts/data-builds.ts`), so a version no release used costs nothing lasting. Mandarin and Cantonese readings may live on `regional_groups` or in a readings table; phase 5 decides.

### Fonts and data must not drift apart

The overprint and the "same glyph" claims are only honest if the fonts drawn are the ones the CMaps were read from. Pin the Source Han and Noto revisions in code, as hanji does, and build the fonts and the data from the same pins. A change of pin is then a code change, released with the extension.

## Phases

Each phase ends with `vp check` clean, tests green (and, from phase 3, E2E in VS Code), and a bump file. Phases 1–3 ship the core; 4–7 build on it in order.

### Phase 0 — Spikes (done 2026-11-10)

Throwaway scripts, not product code; the results below are what phases 1–6 build on. Each was run against hanji's published `chars.json` (8,449 groups) and the sources pinned at hanji's commits.

1. **Glyph partitions.** The CMap reading and the sans ∪ serif union, ported from hanji, reproduce hanji's published glyph signatures for **all 8,449 groups** (five regions plus the old form), with no differences. Computed over our four regions without Korea, **8 groups** come out differently from hanji's signatures with Korea dropped afterwards: in each, Korea was the only link joining two regions (冤, for example, is one form everywhere with Korea, but Japan stands apart without it). We compute over our own regions. Across China, Hong Kong, Taiwan and Japan: **1,719** groups are written the same way everywhere, **3,026** have two forms, **3,117** three and **587** four; **372** also have a Japanese old form.
2. **Taiwan's list.** Settled with CNS 11643 open data (see "Taiwan's list" under Data).
3. **Taiwan's stroke counts.** Taiwan's official counts (CNS 11643) differ from hanji's for **1,263 of 8,446** Taiwan forms (15%). hanji takes a count from the stroke-order drawing and otherwise from Unihan, and AnimCJK has a Traditional Chinese drawing for only 994 groups, so most of its Taiwan counts are Unihan's single count. The differences are regional conventions, not noise: 1,137 are one stroke more in Taiwan (the "grass" radical written with 4 strokes, as in 著, 12 not 11; the "altar" radical in its fuller form, as in 神, 社, 視; the traditional "movement" radical, as in 返, 8 not 7), 68 are two more, and 58 are fewer (統, 致). Wiktionary agrees where it says (返: "8 strokes in traditional Chinese and Korean, 7 strokes in simplified Chinese and Japanese"). **Taiwan's counts therefore come from CNS 11643 first** (phase 1), and our counts will deliberately differ from hanji's there.
4. **Fonts.** Subset to our four regions, with regions sharing a glyph also sharing one region's font, in chunks of 300 characters: **5.01 MB** for all groups, **4.40 MB** for the 7,213 groups whose Japanese form is in our `kanji_characters`. Under the 5.2 MB target.
5. **Stroke order.** Of the 8,449 groups, AnimCJK has a drawing for Japan in 5,173, China in 7,223 and Taiwan in 994; Hong Kong can borrow one in 1,264 and the old form in 344 of 372. Adding China's and Taiwan's drawings means **5,508** drawings, **15.5 MB** of raw outline data at most (less for our scope, and it compresses well). Deduplicating against the Japanese drawings saves almost nothing: AnimCJK draws each language's set separately, so outlines rarely match exactly. In **23** groups China and Japan share a glyph but AnimCJK's drawings have different stroke counts; phase 1's tests list them. AnimCJK also publishes these drawings as per-character SVGs in our player's format (`svgsZhHans/`, `svgsZhHant/`), so phase 4 needs no SVG generation.
6. **Wiktionary.** One pass over the full dump (11.1 million entries) takes **141 seconds** and keeps **41,637** entries for the 11,324 characters in scope (Translingual 11,326, Chinese 16,212, Japanese 14,099). Pruned to the fields below, the result is **18.8 MB**. A quick filter that matched the first `"word"` key in each line lost about 2,700 Japanese entries, because nested objects carry `word` and `lang` keys too; the extraction must test the parsed entry's own top-level fields. What the entries give, in English:
   - **Where the shape came from.** A Chinese entry's `etymology_text` often explains the glyph: 晚 is "a phono-semantic compound: semantic 日 + phonetic 免"; 學's note explains how its parts were added and how one of them "corrupted" in the modern form. The Translingual entry notes simplification: 学 was "simplified from 學 … in simplified Chinese and Japanese shinjitai".
   - **Meanings by language**: Chinese senses in English (學: "to learn; to study", "school"), Japanese senses (晚: "evening, night, late").
   - **Variant forms, labelled**: Japanese entries tag forms as `shinjitai` or `kyūjitai` (晚's Japanese entry gives 晩 as its shinjitai), which cross-checks our grouping.
   - **Readings**: Mandarin (pinyin) and Cantonese (jyutping) in `sounds`, kept; the many other Chinese varieties are dropped.
   - **A summary line** in each Translingual entry: radical, stroke count (sometimes per region), Cangjie code and composition.
   - Simplified forms often have no Chinese entry of their own, only a redirect to the traditional form ("see 學"); take the notes from the traditional form's entry.

The Taiwan source is a Taiwan government dataset under an attribution licence, as the user preferred (decision 2), so no further decision is needed before phase 1.

### Phase 1 — Data

Build the regional tables in the data build: CMap partitions (sans ∪ serif) over our four regions, OpenCC grouping, list tiers (Unihan, and CNS 11643 for Taiwan), stroke counts, and old forms. Taiwan's stroke counts come from CNS 11643 first, then Unihan; Japan's from Kanjidic2, so the regional view agrees with the kanji page beside it; China's from Unihan, until phase 4's drawings; Hong Kong's from a region that draws the same glyph with the same code point. Schema 8.

**Tests (each says why):** 晚/晩 (different code points, 2 forms); 返 (one code point, 4 forms: the case code points alone cannot show); 有 (Taiwan alone differs, by glyph only); 学/學 (2 forms, and Japan's old form shares Hong Kong and Taiwan's glyph); a character identical everywhere; 返 and 著 (Taiwan's official count is one more than China's and Japan's: the regional stroke difference hanji misses); 冤 (Japan stands apart once Korea no longer links the regions). A one-off script (not CI) diffs our partitions and stroke counts against hanji's for every shared row; every difference is explained (Taiwan's official counts, the 8 groups Korea linked) or fixed.

**Done when** `dictionary-v8` builds in CI with the new tables and `verify-db` checks them.

**Results (2026-11-10).** `scripts/regional.ts` builds **8,418 groups**, **378** with a Japanese old form (34,050 form rows), in both the common and the full dictionary. Our sources and our four regions need five rules hanji does not have. Each has a unit test that fails when the rule is removed:

1. **Hong Kong's index is the entry, not the code point.** Unihan gives one `kHKGlyph` index to the list's character and to its variant code points (舉 and 擧, 煙 and 烟). Read as separate entries, each became a group of its own repeating another's.
2. **A group no list names that repeats another group goes.** Without Korea's table of one-character pairs (hanji's `krToStandard`), names such as 鷄 and 雞, or 竝 and 並, made two groups for one character: the kanji page for 鶏 would have found both. A group stays when a list enters its name (吃 is a character of its own, not only how China writes 喫), or when its only listed form is China's (并 stands for 並, 併 and 幷).
3. **Two tables must agree to join two orthodox forms.** Japan's table gives 麵 and 麪 as the orthodox forms of 麺, and Taiwan's writes 麪 as 麵, so they are one character: China 面, Hong Kong 麪, Taiwan 麵, Japan 麺. One table alone is not enough: joining every Taiwan and Hong Kong pair merged 吃 with 喫, 齶 with 顎 and 蔘 with 參.
4. **Japan's old form also comes from Japan's own pair**, when the group named by that form has gone (rule 2) and no other group holds it. That gives 17 old forms hanji loses when it merges rows, including 真 ← 眞, 研 ← 硏, 即 ← 卽 and 郎 ← 郞; it does not give 予 the old form 豫, because 豫 has its own group.
5. **The common list must be 4,808**, since CNS 11643 is not pinned (see "Taiwan's list").

`scripts/compare-regional.ts` (not CI) diffs a built database against hanji's published data. Every difference falls into a class with a reason:

| Difference                        | Count | Why                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Glyph signature                   |    23 | 8 groups Korea linked (冤 and others); 15 where we add an old form hanji lost (rule 4)                                                                                                                                                                                                                |
| Columns                           |    17 | Hong Kong only: Unihan names another code point than hanji's transcription (倶 for 俱, 够 for 夠), or one index holds two code points and the group's name is shown (群, not 羣)                                                                                                                      |
| Groups hanji has and we do not    |    36 | Hong Kong variant code points (擧, 櫈); pre-reform names (餠, 鬭); entries of hanji's lists that ours lack (Hong Kong's 吿, Japan's bracketed 頬); groups only Korea's column kept apart (毁, and 秘, whose four columns match 祕's); and the same groups under other names (僞 is 偽 here, 麵 is 麪) |
| Groups we have and hanji does not |     6 | Hong Kong entries in Unihan that hanji's list lacks (枏, 粺, 薶), 别 (below), and two names (偽, 匀)                                                                                                                                                                                                  |
| Stroke counts outside Taiwan      | 1,254 | Mostly Hong Kong taking Taiwan's official count where it draws the same glyph                                                                                                                                                                                                                         |

Known limits, left as they are: where Hong Kong's index holds two code points and OpenCC names neither, the group's own name is shown, so Hong Kong shows 群, 峰 and 唇 where its list may print 羣, 峯 and 脣 (5 groups). Hong Kong's list enters 别, not 別, so 别 is a group of its own beside 別. The tests on real characters (晚, 返, 有, 學, 著, 一, 冤) run against a built database, which CI's test job does not build, so they run locally; in CI, `verify-db` checks 學's forms and Taiwan's 8 strokes for 返 in the release gate.

### Phase 2 — Region fonts

Subset Noto Sans CJK SC, TC, HK and JP to the characters each must draw (sharing by group), in chunks of about 300 characters split by Unicode range, with no OpenType layout closure (a single character never needs it, and dropping it halves the output). Rename the families (for example "Jisho Regional Sans JP"; never "Hanji"): Noto CJK reserves no font name under its OFL, but "Noto is a trademark of Google Inc." is in the font, and a modified subset should not present itself as Noto. Bundle them in the `.vsix` and add the OFL notices.

**Done when** a test page renders each region's glyph for the phase 1 test characters from the bundled fonts, and the `.vsix` size delta is recorded.

**Results (2026-11-10).** `scripts/build-regional-fonts.ts` builds the fonts from Noto Sans CJK 2.004 at the commit hanji pins beside the Source Han CMaps, and computes the groups with phase 1's code, so the forms subset are the forms the data shows. Output is committed, like the stroke SVGs, and a rebuild is byte-identical.

- **Size.** SC 8,190 characters, HK 5,128, TC 1,256, JP 4,841: 68 files, **4.65 MB**. The packaged `.vsix` is 33.09 MB with them, **+4.66 MB (+16%)**. Three forms have no glyph in Source Han, and so none in Noto (𡑍, 𣈶, 𥗽); they fall back to a system font.
- **Names.** "Jisho Sans SC", "Jisho Sans HK", "Jisho Sans TC" and "Jisho Sans JP". The names are rewritten in place, so each must fit Noto's ("Noto Sans CJK JP" is 16 characters, and "Jisho Regional Sans JP" does not). Each file keeps its copyright and licence records and drops "Noto is a trademark of Google Inc.". THIRD_PARTY_NOTICES carries the full OFL.
- **Which font draws a form** is one function, `fontRegionOf` in `src/shared/regionalFonts.ts`, read by both the build and the webview. Regions that write a form with the same glyph and code point share the first one's font, so a cell the view calls identical is drawn from one glyph. Japan's old form borrows the same way, or uses Japan's font.
- **Delivery.** Vite bundles the fonts into `dist/webview/fonts/`. It needed two settings: `base: "./"`, because with the default "/" every font URL pointed at the webview origin's root and would 404 (the dev server serves both, so only the build shows it), and never inlining a font, because the CSP allows fonts only from the extension. A packaging test checks the built URLs, and CI's check job now builds the webview so the test runs there.
- **Ranges.** Each chunk's `unicode-range` is one span, first to last code point. Listing every code point made the stylesheet 131 KB, parsed before the webview's first paint; spans make it 18 KB. Spans never overlap, and a form is drawn only in the family whose font holds it.
- **The test page** is a Chromium component test: it loads the bundled faces for 晚, 返, 有, 學 and 一, then draws 返 in four different shapes and 有 differently in Taiwan alone.

### Phase 3 — The Regional forms view and the kanji page summary

The overprint (all behaviours, theme inks, non-colour labels, reduced motion), the narrow chart, the summary block on KanjiDetail, and English-language links. The README's "Data sources" and the About view gain the regional sources here, when users first see the data; THIRD_PARTY_NOTICES has had them since phase 1.

**Done when** E2E in VS Code opens 学, sees the summary, opens the view, separates the stack, and finds 學 labelled with its regions, in both a light and a dark theme.

**Results (2026-11-10).** `e2e/visual/regional-forms.e2e.ts` does exactly that in both themes, and checks that the forms are drawn in the bundled region fonts (the one test that can, since component tests run on Vite's dev server). The README has a "Regional forms" section with a generated screenshot pair, its claims asserted in `e2e/docs/claims.docs.e2e.ts`.

- **Data.** `getRegionalForms(literal)` returns the groups in which the kanji is Japan's form or Japan's old form: one for 学, two for 予 (予 itself first, then 豫, which Japan also writes 予), and 學's page reaches its group through the old form.
- **The kanji page** shows, under the readings, one button with a small overprint and a line per group ("Written differently in Hong Kong and Taiwan · 2 forms · old form 學"). When every region writes the kanji alike and there is no old form, one quiet line instead. Nothing for a kanji outside the lists, or while loading, so the page never jumps.
- **The view** (`RegionalForms`) has the overprint, **Overprint** / **Separate** and **Outline** toggles, then per group a count, a chart with one row per distinct form (Japan's first: regions, code point, stroke count, lists) and Wiktionary and Unihan links per form. When every form is one code point, the count says so once ("4 forms of one code point, U+8FD4"); otherwise the note sits on the rows that share one.
- **The overprint** keeps hanji's behaviours: resting the pointer fans the layers 3 px apart and lights each form in turn while a caption names it; press-and-drag pulls them apart, and they spring back with an overshoot; fill fades from 0.42 to 0.24 as strokes rise; text is not selectable. One registered clock (`--overprint-lit`) and two registered lengths (`--overprint-fan`, `--overprint-pull`) drive it all, and the drag script writes only the pull. Switching modes is a view transition. With reduced motion there is no fan, no spring and no transition; lighting each form in turn is a change of colour, so it stays.
- **Inks.** Fixed, not derived from the foreground as planned: at a dark theme's foreground lightness, blue clips out of sRGB (CONVENTIONS.md). `--jisho-ink-*` in `theme.css` are five hues at L 0.74 C 0.13 on dark grounds and L 0.55 C 0.11 on light ones, in gamut for all five. The first two are orange and blue: two forms is the common case, and red against green, the order first tried, is the pair colour-vision deficiencies lose. The chart draws each row in its layer's ink.
- **Not by colour alone.** The stack's accessible name lists every form and its regions; the caption names the lit form; Separate labels each form; the chart names everything.
- React's `CSSProperties` gained an index type for `--` properties (`src/webview/react-css.d.ts`), so the components set custom properties without casts.

### Phase 4 — Stroke order by region

Ingest AnimCJK's Simplified and Traditional Chinese drawings for the groups in scope, let Hong Kong and the old form borrow per glyph group, and add the region switcher to the stroke-order view. AnimCJK publishes these as per-character SVG files in the same format as the Japanese set we use (`svgsZhHans/`, `svgsZhHant/`, named by decimal code point), so no SVG needs generating; our vendored Japanese SVGs carry an extra guides layer that these lack, which the player must handle. Follow the delivery path and lessons of [STROKE-ORDER.md](../STROKE-ORDER.md).

**Done when** 学 plays China's and Japan's order, 學 plays Taiwan's, and a region with no drawing says so.

**Results (2026-11-11).** `e2e/visual/regional-forms.e2e.ts` plays 学 as China and Japan write it, 學 as Taiwan does (16 strokes), and finds "There is no stroke-order drawing for 返 as Hong Kong and Taiwan write it."

- **Scope, decided with the user on 2026-11-11: jōyō kanji only, as files.** Phase 0's size estimate was low: it measured AnimCJK's raw data, and our transformed SVGs, with outlines, clip paths and guides, are 2.7 times larger (8.2 KB each). Every group with a kanji page would have added 17.6 MB to the `.vsix`, and the dictionary download would have split the drawings across two delivery paths. The jōyō scope adds **5.5 MB** (China 4.00, Taiwan 1.51): the `.vsix` is 39.23 MB. A non-jōyō kanji's stroke page shows Japan's drawing only, as before.
- **Shared drawings are checked, not assumed.** `scripts/build-regional-strokes.ts` compares AnimCJK's medians: two drawings take the same strokes in the same order when they have as many strokes and each starts and ends within 140 units (of 1024) of the other's. Of 2,154 jōyō groups, China has 1,518 drawings of its own and shares Japan's in 567; Taiwan has 464 of its own and shares 369. China writes some kanji with Japan's glyph in another order, 右 and 有 among them (Japan starts both with the left-falling stroke), and they get their own drawing. Where they share, `assets/regional-strokes.json` records it, beside the drawings it describes.
- **Hong Kong** has no set of its own. It borrows the drawing of the region that writes the same glyph at the same code point, Taiwan first, then China, then Japan. **Japan's old form** borrows the same way, or has Japan's drawing of the old character.
- **A form nothing draws stays undrawn.** The host groups the columns by drawing and lists undrawn forms with no SVG. The view says so in words ("…for 返 as Hong Kong and Taiwan write it") rather than play another region's order.
- **The view** shows a button per drawing, labelled with its regions, Japan's first, only when there are two or more. The player starts the new drawing from stroke 0.
- The Chinese drawings go through the same `transform` as Japan's, so the guides and chart work unchanged; they carry no part hit-targets, since AnimCJK's Chinese decompositions were not read. They are renamed to code points in the `.vsix` like the others, and `ARPHICPL.TXT` ships in each directory.

### Phase 5 — Readings and frequency by region

Mandarin and Cantonese readings from Unihan, and each region's frequency rank from the sources above, on the view and in the browse's sort.

**Done when** 学 shows its Mandarin and Cantonese readings and a labelled rank for each region, and the new sources are in THIRD_PARTY_NOTICES.

**Results (2026-11-12).** The view has a "Readings and frequency" section: one line per region with its form, its reading and its rank, and `e2e/visual/regional-forms.e2e.ts` finds xué, hok6 and the four labelled ranks for 学. Schema 9 adds `reading` and `freq` to `regional_forms`.

- **China's frequency source had no licence (decision 8, 2026-11-12).** The plan listed Jun Da's list as MIT, but MIT covers only hanziDB's repository: Jun Da's page says "Copyright 1998-2026 Jun Da" and grants nothing. No clearly licensed alternative turned up: SUBTLEX-CH is "freely available for research purposes" only, and Chinese Wikipedia mixes simplified and traditional source text. The user chose to use Jun Da's list with credit; THIRD_PARTY_NOTICES says so plainly. The other three are clean: words.hk (public domain), NAER (open data with credit) and kanji-frequency (CC BY 4.0).
- **Each region's rank is for its own form, from its own corpus**: China 学 #66 in modern Chinese texts, Hong Kong 學 in words.hk's Cantonese texts, Taiwan 學 #93 in news and social media (NAER, 2023), Japan 学 #5 on Japanese Wikipedia. Every rank in the view names its corpus, since four corpora are not one scale. Ranks are competition ranks over Han characters only: the count files also count punctuation and Latin letters. `scripts/frequency.ts` ports hanji's CSV, ranking and workbook readers, so NAER's Excel file is read with no spreadsheet library. hanziDB and kanji-frequency are pinned to commits; words.hk's file is live and unversioned, so the build records the day it was read.
- **Readings come from Unihan.** China lists every reading its 2013 standard gives a polyphone, the most frequent first (行: xíng, háng, héng), because kTGHZ2013 sorts them alphabetically. Taiwan takes Unihan's Taiwan value where kMandarin has one. Hong Kong's are Jyutping, and Japan's are the kanji page's own on and kun readings, joined from `kanji_characters` rather than copied.
- `verify-db` fails a build in which 學's group lacks a rank or a reading. Each source must yield thousands of characters, or the build fails (`scripts/frequency.ts`).
- The browse's sort by region comes with phase 7.

### Phase 6 — Wiktionary notes

The extraction job, the pinned release asset, and the "From Wiktionary" block, with credit and link. The extracted variant labels also feed a test that cross-checks phase 1's grouping: a group Wiktionary links but we split, or the reverse, is listed and explained.

**Done when** 学 shows the note that it was simplified from 學, linked to Wiktionary, and the cross-check runs.

**Results (2026-11-12).** The view has a "From Wiktionary" block: each character's notes, Japan's form first, every note linked to the section of the page it is quoted from, and a CC BY-SA 4.0 credit. For 学 it reads "Simplified from 學 (𦥯 → 𰃮) in simplified Chinese and Japanese shinjitai", then 學's account of how its parts came together; `e2e/visual/regional-forms.e2e.ts` checks the first and its link. Schema 10 adds `regional_notes`, keyed by character.

- **The extraction keeps every single Han character**, not the characters the build groups today, so a change to the grouping never needs a new extraction. It is still small: 105,205 entries, **1.5 MB** compressed (the 18.8 MB measured in phase 0 kept senses and readings; the notes and the cross-check need neither). One pass over the full dump takes 153 seconds. `scripts/extract-wiktionary.ts` does it, the `wiktionary` workflow publishes it under `wiktionary-YYYY-MM-DD`, and `scripts/wiktionary.ts` pins it by tag and checksum, so two builds of one commit show the same notes.
- **A note** is the first Translingual etymology on a character's page (how its forms relate across languages; only 112 characters have one, 学 among them) and the first Chinese etymology (where the shape came from). Wiktextract leaves some pages' pronunciation tables in the etymology (嫂's has 92 such lines), and some etymologies only send the reader elsewhere ("For pronunciation and definitions of 台 – see 鮐"); both are dropped, and THIRD_PARTY_NOTICES says so. 6,469 notes cover 6,465 of the groups' 11,307 characters (1.4 MB in the database).
- **The cross-check runs in every data build** and fails on a difference that `EXPLAINED` in `scripts/wiktionary.ts` has no reason for, or on a reason whose difference is gone. In one direction it takes the cleanest labels Wiktionary has, Japan's shinjitai and kyūjitai: of the 404 labelled pairs whose forms we group, we keep **9** apart, and hanji keeps the same 9 apart. In 3 (喩 and 喻, 娯 and 娛, 駄 and 馱) Japan's form is a variant that OpenCC's shinjitai table does not name; in 6 (閒 for 間, 辦 and 辮 for 弁, and others) Wiktionary names an old form that OpenCC does not. In the other direction, Wiktionary has no clean label for China's simplification, so any mention on a page counts as a link, and a group whose forms the links do not connect is listed: **57**. Checking their pages showed that in 55 the pages do name each other, but Wiktextract loses the link (业's page sends the reader to 業, 丘 and 北; the extraction keeps only 丘 and 北). In the other 2, Wiktionary gives 韝 another simplified form, and links 鹇 and 鷴 only through a third form, 鷳. None needed a change to the grouping.
- The extraction the data build reads is a release asset of this repository. The first, [`wiktionary-2026-11-12`](https://github.com/Saeris/vscode-jisho/releases/tag/wiktionary-2026-11-12), was uploaded by hand with the user's approval, since the workflow can only be dispatched from `main`: the Wiktionary dump of 2026-10-01, as kaikki.org extracted it on 2026-10-30.

### Phase 7 — Browse and filters

The "Regional differences" list in the Kanji browse tab, with the filters above, in the sidebar's width.

**Done when** filtering to "Japan alone differs" and sorting by stroke count gives the expected first rows by test, and the list stays fast on the full table.

**Results (2026-11-12).** The Kanji tab has a "Regional differences" entry below its lists. "Japan alone differs", sorted by Japan's stroke count, starts with 乃 (2 strokes), then 么, 之, 山, 广, 弓 and 才 (3): characters every region writes at one code point but Japan draws its own way. 1,157 groups match. `db.spec.ts` checks the first seven against the built dictionary, and `e2e/visual/regional-forms.e2e.ts` the first two in VS Code.

- **The whole table goes to the webview once.** One request (`browseRegional`) returns all 8,418 groups in two queries, the forms and Japan's readings joined from `kanji_characters`: about 1.7 MB as JSON, read in 150 to 190 ms. TanStack Query keeps it for the session, and `src/shared/regionalBrowse.ts` filters it in memory: a pattern and a sort take about 6 ms; a reading search about 12 ms, once each group's readings are folded (the first search folds them; folding on every keystroke took 200 ms).
- **Only the rows in view are rendered**, by React Aria's `Virtualizer`: fewer than 60 of 8,000 in the component test. React Aria turns virtualizing off in tests unless `process.env.VIRT_ON` is set, and reads `process.env` at run time, which a browser has none of; the component project defines both, so the test virtualizes against Chromium's real layout, as the webview does.
- **The filters, adapted to the sidebar.** The search stays in view; a **Filters** disclosure, at most half the sidebar's height, holds the rest: the number of forms, where two or three open their exact splits (7 and 6 of them, named in words: "Japan alone differs", "China and Japan versus Hong Kong and Taiwan", "Only China and Hong Kong agree"), then one region for both the stroke range and the order, the order (frequency, strokes, code point), the stroke range, and the lists. hanji's "compare by glyph or code point" is left out: the patterns are by glyph, as the overprint is.
- **The search** finds a group by any form it writes (the old form too: 眞 finds 真), by code point (`U+5B66` or `5b66`), or by reading, with tone marks and kana script folded and the kun reading's dot ignored. Voicing marks stay (`gaku` finds ガク but not か.く), and romaji is read as kana for Japanese readings. The webview already bundled wanakana, so this adds nothing to its size.
- A row opens the Regional forms view for its Japanese form.

### Later

- **Lookup from any regional form** (decision 5): searching 學 or 國 (traditional forms) resolves to the Japanese kanji 学 or 国, and 们 (a simplified Chinese form) to 們, with a note on how they relate. The `char` index in schema 8 is there for it.
- **Korea** (decision 3): the Korean column, font, stroke order (AnimCJK has 535 Korean drawings) and Korea's education list (Unihan `kKoreanEducationHanja`).

## Risks

- **Size.** Fonts (about 5 MB at most) and extra drawings both grow the `.vsix`. Measure in phase 0; drawings may belong in the DB instead.
- **Hong Kong is under-covered by Source Han**, so "only Hong Kong differs" is under-reported (hanji says the same). State it on the view.
- **Our stroke counts differ from hanji's on purpose.** Taiwan's official counts (phase 0, finding 3) disagree with hanji's for 15% of Taiwan forms. The phase 1 diff must report these as explained, never "fix" them back to hanji's.
- **The grouping logic is subtle.** hanji's build spends most of its length on edge cases; our adaptation will get some wrong. The diff against hanji (phase 1) and the Wiktionary cross-check (phase 6) are the safety nets.
- **Hue-only inks** (see the overprint design) need the label channel to ship in the same phase.
- **Taiwan's list may have no clearly licensed source.** Phase 0 brings the options back to the user rather than choosing one.
- **The Wiktionary dump is large and its per-language files are going away.** The extraction job runs on demand, not in every build.
- **The data release.** Each schema bump means its `dictionary-v{N}` must exist before the release that reads it; the release gate already checks this.
