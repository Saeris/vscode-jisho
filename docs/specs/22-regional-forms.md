# Spec 22 — Regional forms: one kanji across Japan, China, Hong Kong, Taiwan and Korea

> **Status:** plan, for review. Nothing is built yet. **Backlog:** #56. **Based on** a study of [hanji](https://github.com/sxzz/hanji) (code MIT, compiled data CC BY 4.0) on 2026-11-10: its live site, explored with Playwright, and its source at commit `f0ae600`.

## Why

A kanji you meet outside a Japanese textbook is often not the form Japan writes. Chinese text uses simplified or traditional forms; signs, names and older books use the forms Japan wrote before its postwar reform (kyūjitai, "old forms"); Korean hanja keep traditional forms. Sometimes the difference is a different character with its own code point (学 in Japan, 學 in Taiwan). Sometimes it is the same code point drawn differently: 返 is one Unicode character, but China, Japan, Hong Kong and Taiwan each draw it slightly differently, most visibly in its "movement" radical (shinnyō).

The user wants to fold most of hanji into our kanji pages so that a learner can:

- take a form seen in the wild and find the Japanese kanji it corresponds to;
- see how each region writes it, stacked on top of one another so the differences stand out;
- compare code points, stroke counts and official list status in one chart;
- watch the stroke order each region teaches;
- search and filter the whole table of regional differences.

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
- **Glyph identity** ([`scripts/cmap.ts`](https://github.com/sxzz/hanji/blob/main/scripts/cmap.ts)). Adobe's Source Han fonts draw all five regions from one shared pool of glyphs, with a per-region map from code point to glyph ID (CID). Two regions write a character the same way exactly when their maps give the same glyph ID. No outlines are compared. hanji does this for both the sans and the serif family and treats two regions as the same if **either** family gives them one glyph, so a difference only one typeface makes (a design choice, not a regional convention) is ignored.
- **The partition signature.** Each row stores its regions' glyph IDs as a string numbered in order of first appearance: `"00000"` when all five agree, `"0112"` when the first stands alone, the middle two agree and the last differs. The same is done for code points. Every filter, chip and grouping on the site reads these two strings.
- **Stroke counts** come first from the stroke-order data (the number of strokes actually drawn), then from Unihan (`kAlternateTotalStrokes`, `kRSAdobe_Japan1_6`, `kTotalStrokes`).
- **Frequency** comes from a different corpus per region (Chinese text, written Cantonese, Taiwanese news and forums, Japanese Wikipedia).
- **The build** is about 1,100 lines ([`scripts/build-data.ts`](https://github.com/sxzz/hanji/blob/main/scripts/build-data.ts)), most of it reconciling OpenCC with the official lists: folding rows that name the same character, keeping apart characters a region lists separately, and flagging relations the lists do not confirm.

### Fonts

The display uses Noto Sans CJK in each regional version (SC for China, TC for Taiwan, HK, JP, KR), subset to the characters in the table. Two tricks keep it small: regions that write a character the same way share one region's glyph, so the others do not carry it (about a third fewer glyphs, and the cells shown as identical really are one glyph); and each font is split by Unicode range in order of commonness, so the browser loads only the pieces on screen. **Measured: 5.37 MB for the sans fonts of all five regions** (China 1.96, Hong Kong 1.51, Japan 1.38, Taiwan 0.35, Korea 0.17).

### Stroke order

hanji reads AnimCJK's per-language data: Simplified Chinese for China, Traditional Chinese for Taiwan, Japanese, and Korean. Hong Kong (and the old Japanese form) borrow the drawing of a region that writes the same glyph. When two regions' ordered strokes are identical, only one drawing is stored. **Coverage is uneven** (AnimCJK at hanji's pinned commit):

| AnimCJK set         | Characters | Size    |
| ------------------- | ---------- | ------- |
| Japanese            | 7,007      | 21.9 MB |
| Simplified Chinese  | 8,014      | 22.6 MB |
| Traditional Chinese | 1,013      | 3.0 MB  |
| Korean              | 535        | 1.4 MB  |

So Taiwan, Hong Kong and Korea will have no drawing for most characters, which is why hanji's page for 返 offers only China and Japan.

### Licences and names

- **Code: MIT.** We may port it, keeping its copyright notice.
- **Compiled data** (the row structure, selection and arrangement): **CC BY 4.0**, attribution "Hanji data by Kevin Deng, CC BY 4.0, https://github.com/sxzz/hanji".
- **Third-party data** keeps its own licence (table under "Sources and licences").
- **The name "Hanji" and its logo are excluded from both licences.** We may not use them as the name of our feature. A plain credit such as "based on Hanji" in our notices is allowed.
- **One source has no licence:** hanji takes the five official lists from a transcription (`zispace/hanzi-chars`) whose repository states none.

## What we adopt, adapt and leave out

| hanji feature                                       | For jisho                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Glyph identity from Source Han CMaps (sans ∪ serif) | **Adopt** as is: small, exact, licence-clean                                                                            |
| Row building (OpenCC + lists)                       | **Adopt the method**; port and test it (see the data decision)                                                          |
| Overprint stack and its interactions                | **Adopt**, with our theme tokens and a non-colour channel                                                               |
| Comparison chart with merged cells                  | **Adapt** for a narrow sidebar                                                                                          |
| Stroke order per region                             | **Adopt**, on our existing stroke player                                                                                |
| Region fonts, subset and shared by group            | **Adopt**                                                                                                               |
| Search and filters                                  | **Adapt** into the Kanji browse tab                                                                                     |
| Readings in other languages                         | **Optional** (phase 7)                                                                                                  |
| Frequency per region                                | **Optional** (phase 7); each corpus has its own terms                                                                   |
| External dictionary links                           | **Adapt**: English-language ones only (Wiktionary, the Unicode Unihan page), since most of hanji's are Chinese-language |
| Interface languages, serif typeface, PWA, OG images | **Leave out**                                                                                                           |
| The name and logo                                   | **Leave out** (not licensed)                                                                                            |

## Design for jisho

### Where it lives

- **A summary on the kanji page.** When a kanji has regional forms that differ, KanjiDetail gets a compact block under the readings: a small overprint, a line such as "Written differently in China and Taiwan · 3 forms", and a button into the full view. When every region writes it the same way, a single quiet line says so.
- **A "Regional forms" view.** Opened from that block, the same way the stroke-order and component-tree views open today: the overprint, the chart, stroke order by region, and links.

### The overprint

Ported from hanji with its behaviours (fan on rest, highlight each form in turn, press-and-drag to separate, spring back, outline mode, the Separate/Overprint toggle). Changes for us:

- **Inks from our theme.** Five hues at equal lightness, derived in oklch from the theme's foreground per [CONVENTIONS.md](../CONVENTIONS.md), with the light-theme value under `body.vscode-light` (not `prefers-color-scheme`). Blend with `darken` on light themes and `lighten` on dark ones. Verify contrast on both themes in the E2E captures.
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

The existing stroke-order view gains a region switcher above the player, one choice per distinct drawing ("Japan", "China", "Taiwan · Hong Kong", "Korea", "Old"). A region with no drawing says so plainly ("No stroke-order data for Taiwan's form") instead of falling back silently to another region's order, because a different order is exactly what the learner is checking.

### Looking up a form seen in the wild

Search accepts any regional form. Searching 學 or 國 (traditional forms) resolves to the Japanese kanji 学 or 国, and 们 (a simplified Chinese form) to 們, and the results say how they relate ("學 is the traditional and old Japanese form of 学"). This is the entry point for "I saw this somewhere": without it, the feature is only reachable from kanji the user can already type.

### Browse and filters

The Kanji browse tab gains a "Regional differences" list with hanji's filters, adapted: search (character, reading, code point), difference pattern (same everywhere, 2/3/4/5 forms, then the exact split chips), list membership, stroke-count range for a chosen region, sort by stroke count or code point (and frequency if phase 7 lands). Each result row: a small overprint, then the forms in a compact strip grouped by region.

## Data

### Scope

All character groups in the union of the five official lists, about 8,400. The whole set is small (hanji's JSON is 3.1 MB, 430 KB gzipped) and lookup from Chinese forms needs groups whose Japanese form is unlisted. The kanji page shows the block only for groups whose Japanese form is in our `kanji_characters`.

### Sources and licences

| Use                                               | Source                                                                                                                                 | Licence                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Whether regions share a glyph                     | Adobe Source Han Sans and Serif, region CMaps (10 small files)                                                                         | SIL OFL 1.1                                       |
| Display fonts                                     | Noto Sans CJK SC, TC, HK, JP, KR, subset and renamed                                                                                   | SIL OFL 1.1                                       |
| Which forms belong together                       | OpenCC variant tables                                                                                                                  | Apache-2.0                                        |
| China, Japan, Hong Kong and Korea list membership | Unihan: `kTGH` (China 2013 table, with its three levels by index), `kJoyoKanji`, `kJinmeiyoKanji`, `kHKGlyph`, `kKoreanEducationHanja` | Unicode License v3                                |
| Taiwan list membership                            | **Open question** (no Unihan field exists)                                                                                             | —                                                 |
| Kyōiku grade                                      | Kanjidic2 (already in our DB)                                                                                                          | CC BY-SA 4.0 (already attributed)                 |
| Fallback stroke counts                            | Unihan                                                                                                                                 | Unicode License v3                                |
| Stroke order                                      | AnimCJK: Simplified Chinese, Traditional Chinese and Korean sets, in addition to our Japanese set                                      | Arphic Public License (already shipped and noted) |
| The method, and any ported code                   | hanji                                                                                                                                  | MIT (keep the notice)                             |

Taking list membership from Unihan instead of hanji's source avoids the unlicensed transcription for four of the five lists.

### Schema (schema 8)

A proposal for the implementing phase to refine:

```sql
-- One character, as the regions write it (hanji's "row").
CREATE TABLE regional_groups (
  id        INTEGER PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE,  -- the traditional form, as hanji keys it
  glyph_sig TEXT NOT NULL,         -- partition of (cn, hk, tw, jp, kr) by glyph, e.g. '00100'
  cp_sig    TEXT NOT NULL          -- the same, by code point
);

-- One row per region (plus 'old' for Japan's pre-reform form).
CREATE TABLE regional_forms (
  group_id  INTEGER NOT NULL REFERENCES regional_groups(id),
  region    TEXT NOT NULL,         -- 'cn' | 'hk' | 'tw' | 'jp' | 'kr' | 'old'
  char      TEXT NOT NULL,
  glyph     INTEGER NOT NULL,      -- this region's index in glyph_sig
  strokes   INTEGER,
  tier      INTEGER,               -- list level in this region (0 = unlisted)
  listing   TEXT NOT NULL,         -- 'primary' | 'glossed' | 'unlisted'
  drawing   INTEGER,               -- which stroke drawing; NULL when there is none
  PRIMARY KEY (group_id, region)
) WITHOUT ROWID;

CREATE INDEX idx_regional_forms_char ON regional_forms(char);  -- lookup from any form
```

A schema change bumps `SCHEMA_VERSION` to 8 and publishes to `dictionary-v8`, which the per-schema data workflow already handles (see [ARCHITECTURE.md](../ARCHITECTURE.md)).

### Fonts and data must not drift apart

The overprint and the "same glyph" claims are only honest if the fonts drawn are the ones the CMaps were read from. Pin the Source Han and Noto revisions in code, as hanji does, and build the fonts and the data from the same pins. A change of pin is then a code change, released with the extension.

## Phases

Each phase ends with `vp check` clean, tests green (and, from phase 3, E2E in VS Code), and a bump file.

### Phase 0 — Decisions and spikes (no product code)

- Settle the open questions below with the user.
- Spike: read the ten CMaps and compute partitions for a sample of known characters, and compare them with hanji's published `chars.json`.
- Measure: fonts subset to our scope (target well under the measured 5.4 MB), and how many AnimCJK drawings differ from our Japanese ones.

**Done when** the decisions are recorded in this spec and the numbers measured.

### Phase 1 — Data

Build the regional tables in the data build: CMap partitions (sans ∪ serif), OpenCC grouping, list tiers, stroke counts, old forms, and the lookup index. Schema 8.

**Tests (each says why):** 晚/晩 (different code points, 2 forms); 返 (one code point, 4 forms: the case code points alone cannot show); 有 (Taiwan alone differs, by glyph only); 学/學 (2 forms, and Japan's old form shares Hong Kong and Taiwan's glyph); a character identical everywhere. A one-off script (not CI) diffs our partitions against hanji's for every shared row; every difference is explained or fixed.

**Done when** `dictionary-v8` builds in CI with the new tables and `verify-db` checks them.

### Phase 2 — Region fonts

Subset Noto Sans CJK per region to the characters each region must draw (sharing by group), split by Unicode range, rename the families (for example "Jisho Regional Sans JP"; never "Hanji"), ship them in the `.vsix`, and add the OFL notices.

**Done when** a test page renders each region's glyph for the phase 1 test characters from the bundled fonts, and the `.vsix` size delta is recorded.

### Phase 3 — The Regional forms view and the kanji page summary

The overprint (all behaviours, theme inks, non-colour labels, reduced motion), the narrow chart, the summary block on KanjiDetail, and English-language links.

**Done when** E2E in VS Code opens 学, sees the summary, opens the view, separates the stack, and finds 學 labelled with its regions, in both a light and a dark theme.

### Phase 4 — Stroke order by region

Ingest AnimCJK's Simplified Chinese, Traditional Chinese and Korean drawings for the groups in scope, keep only drawings that differ from the Japanese one, let Hong Kong and the old form borrow per glyph group, and add the region switcher to the stroke-order view. Follow the delivery path and lessons of [STROKE-ORDER.md](../STROKE-ORDER.md).

**Done when** 学 plays China's and Japan's order, 學 plays Taiwan's, and a region with no drawing says so.

### Phase 5 — Lookup from any regional form

Search resolves any regional form to its group and Japanese kanji, with a note on how they relate.

**Done when** searching 學, 國 and 们 lands on 学, 国 and 們 with the note, by test and by E2E.

### Phase 6 — Browse and filters

The "Regional differences" list in the Kanji browse tab, with the filters above, in the sidebar's width.

**Done when** filtering to "Japan alone differs" and sorting by stroke count gives the expected first rows by test, and the list stays fast on the full table.

### Phase 7 — Optional: readings in other languages, frequency per region

Mandarin, Cantonese and Korean readings (Kanjidic2 and Unihan), and per-region frequency if its sources' terms suit us.

## Risks

- **Size.** Fonts (≈5 MB at most) and extra drawings both grow the `.vsix`. Measure in phase 0; drawings may belong in the DB instead.
- **Hong Kong is under-covered by Source Han**, so "only Hong Kong differs" is under-reported (hanji says the same). State it on the view.
- **The grouping logic is subtle.** hanji's build spends most of its length on edge cases; a simpler port will get some wrong. The phase 1 diff against hanji is the safety net.
- **Hue-only inks** (see the overprint design) need the label channel to ship in the same phase.
- **The data release.** Schema 8 means `dictionary-v8` must exist before the release that reads it; the release gate already checks this.

## Open questions for the user

1. **Data path.** (a) Port hanji's build into ours, from the pinned sources above (recommended: one reproducible pipeline, licences clear field by field, and hanji's published data used as a cross-check); or (b) ship hanji's published `chars.json` as a pinned snapshot under CC BY 4.0 (fastest, but it carries the unlicensed list transcription and depends on hanji's site).
2. **Taiwan's list.** Unihan has no field for it. Options: Taiwan's Ministry of Education's own publication, if its terms allow; hanji's transcription (no licence stated); or drop Taiwan's list status and keep only Taiwan's forms.
3. **Korea.** hanji hides the Korean column by default. Show it, hide it by default, or leave Korea out?
4. **Font delivery.** In the `.vsix` (recommended: they are needed whatever data is installed, and pinned with the code), or downloaded with the dictionary?
5. **Order.** Is lookup from regional forms (phase 5) worth moving ahead of the stroke order (phase 4)?
6. **Readings and frequency** (phase 7): wanted, or out of scope?
