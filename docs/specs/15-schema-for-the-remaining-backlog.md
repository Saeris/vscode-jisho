# Spec 15 — Re-deriving the schema from the queries we actually run

**Backlog:** #27 (tag search), #35 (gojūon order), #51 (fuzzy search), #26 (BCCWJ), spec 04 (radical position). **Status:** IMPLEMENTED except the `frequency_overrides` seam, which is deliberately design-only. Schema is at version 5; DB 101MB → 97MB net. Measured against the real DB (2026-07-29).

## Why now, and why this exists

The schema was designed for M1's featureset and has accreted since. Every individual decision was defensible when made — JSON for POS was right when POS was display-only; one `search_terms` table was right when it held only word rows — but nothing has re-derived the shape from the queries we now actually run. This spec is that pass.

**The window matters more than any single win.** `SCHEMA_FROZEN` is still `false`, the version is `0.0.0`, and no user has a database. A schema change costs a 60s rebuild today; after the first release it costs every user a 100–400MB re-download. Anything in this document that is worth doing at all is worth doing before the release, and **batched into one version bump** rather than trickled out.

## Already landed (`31749af`, SCHEMA_VERSION 2)

Recorded here so the spec reads as a complete picture, not a diff against a moving target.

- **`sentences.ja` dropped** — 100% derivable from `ja_furigana` via `stripRubyText`. Storing both duplicated 2.8MB and let them drift; each row also carried the column its own reader never used. DB 101MB → 91MB.
- **`words.is_uk` added** — replaced three correlated `misc_json LIKE '%"uk"%'` subqueries. Every caller asked it of the word, not the sense.
- **`kanji.text` / `kana.text` documented as deliberately unindexed** — `search_terms` is the sole lookup surface; querying them directly cost a flat 283ms on the hover path.

## The core change: tags become rows

### The problem, measured

`pos_json`, `misc_json`, `field_json` and `dialect_json` are read as **predicates**, not display data, and SQL cannot reach into them. `resolveByLemma` and the deinflection merge both `group_concat(pos_json, ' ')`, ship the concatenated JSON to JavaScript, parse it with `parseCodes`, and filter with `anyPosMatches`. So:

- rows destined to be discarded are fetched and hydrated anyway;
- POS can never appear in a `WHERE` clause or be indexed;
- **#27 (tag search) is definitionally a cross-word query over these columns** and cannot be built on this shape without a full scan or the same fetch-then-filter-in-JS pattern at much larger scale.

The schema's own design note claimed these arrays are "never queried across words". That stopped being true and now says so.

### The shape

```sql
CREATE TABLE sense_tags (
  sense_id INTEGER NOT NULL REFERENCES senses(id),
  kind     TEXT NOT NULL,  -- 'pos' | 'misc' | 'field' | 'dialect'
  code     TEXT NOT NULL,  -- the JMdict tag code ('v1', 'uk', 'vulg', 'med'…)
  PRIMARY KEY (sense_id, kind, code)
);
CREATE INDEX idx_sense_tags_code ON sense_tags(code, kind);
```

**Measured cost: 65,903 rows** — 57,937 pos + 5,528 misc + 2,395 field + 43 dialect, across 36,972 senses (1.78 tags/sense), over **173 distinct codes**. For scale, `search_terms` is already 427,606 rows. This is a rounding error on DB size, and it is the whole reason to prefer normalization over the wide-sparse-column alternative the user rightly rejected: a column per tag would be 173 columns at ~1% density.

The `code, kind` index order is deliberate — #27 searches by code (`#vulgar` → every sense tagged `vulg`), so `code` leads.

### What happens to the JSON columns

**Drop all four.** `sense_tags` becomes the single source of truth; the word-detail view reconstructs its display lists with one extra join, which it can afford (it already loads senses, and `getWord` measures 0.07–0.10ms).

**Keep as JSON:** `info_json`, `related_json`, `antonym_json`, `applies_to_kanji_json`, `applies_to_kana_json`. These are free text, xrefs and writing-lists — not codes from a closed vocabulary, never predicates. Normalizing them would be churn for nothing.

### Word-level tags too

`words.priority_tags_json` (`news1`, `ichi1`, `spec1`, `gai1`…) has the same problem for the same reason: #27 wants them as both badges _and_ search targets ("this word is in the newspaper top 12,000"). Same treatment, same rationale:

```sql
CREATE TABLE word_tags (
  word_id TEXT NOT NULL REFERENCES words(id),
  code    TEXT NOT NULL,
  PRIMARY KEY (word_id, code)
);
CREATE INDEX idx_word_tags_code ON word_tags(code);
```

### What this unblocks

- **#27 tag search** — `#vulgar` becomes `JOIN sense_tags WHERE code = 'vulg'`, an indexed lookup instead of a scan. `#n5` combines it with `words.jlpt`.
- **POS filtering moves into SQL** — `resolveByLemma` and the deinflection merge stop shipping JSON to JS to decide what to throw away. `anyPosMatches`' compatibility logic stays in `shared/pos.ts` (it encodes real linguistic rules, not storage), but the coarse filter can run in the query.
- **#50 (POS pills)** reads a clean list instead of parsing JSON per sense.

## Also worth doing in the same bump

Ordered by value. All of these are cheap _only_ because they ride the same rebuild.

### 1. `radicals.position` — spec 04, already designed and pending

[Spec 04](04-radical-position-filter.md) is written, signed off, and blocked solely on a DB rebuild. It adds `radicals.position TEXT NULL` (hen/tsukuri/kanmuri/ashi/kamae/tare/nyō, derived by majority vote from AnimCJK's `acjk` field). **Fold it into this bump.** [Spec 05](05-asset-delivery.md) explicitly names this column as the mismatch its schema-version gating exists to prevent — shipping it in the same version as everything else is the cheapest possible path.

### 2. Normalized kana keys — serves #35 and #51 together

Two backlog items need the same primitive from opposite directions:

- **#35 (gojūon order)** — browseable lists sort by codepoint today, which is meaningless for Japanese. Correct order is 五十音順 over the _reading_, with katakana folded to hiragana and small kana/voiced marks handled per JIS X 4061.
- **#51 (fuzzy search, kana layer)** — the Japanese-appropriate typo tolerance is _normalization_, not edit distance: fold small⇄large kana, dakuten/handakuten, long-vowel marks, katakana⇄hiragana.

They share a normalization pipeline but are **not the same key**, and conflating them is the trap: sorting must still distinguish は/ば (they are different words at a lower tier), while search folding wants them collapsed. So:

- `kana.sort_key TEXT` — collation key for ordering. Makes #35 an indexed `ORDER BY` instead of a JS sort, and applies to name results and radical-picker matches too.
- `search_terms.term_norm TEXT` + index — aggressively folded form for #51's kana tolerance.

Build both from one shared normalizer in `shared/` with two settings, so the rules live in one place and are testable independently. **Neither is urgent**, but both are pure additions that cost nothing extra once a rebuild is happening anyway, and #51 explicitly sequences kana normalization _first_ as the cheapest, highest-precision slice.

### 3. Drop `glosses.lang`

100% `'eng'` across all 86,881 rows — we build from `jmdict-examples-eng` and ship English only. Dead weight and a false promise of multi-language support. Re-adding it when a second language actually ships is a smaller change than carrying it unused. (JMdict _does_ publish other languages; this is a statement about what we build, not what exists.)

### 4. `senses.id` — drop `AUTOINCREMENT`

The DB is built once and never mutated, so rowid reuse is irrelevant. `AUTOINCREMENT` costs a `sqlite_sequence` table and per-insert bookkeeping across 36,972 inserts for a guarantee we don't need. Plain `INTEGER PRIMARY KEY`. Trivial, near-zero payoff — do it only because it's free while the file is open.

### 5. Design the `frequency_overrides` seam (do not build)

[BACKLOG #26](../BACKLOG.md#L210) settles that BCCWJ frequency cannot be _redistributed_ but can be _user-imported_, Yomitan-style. That means ranking must eventually consult an optional override layer. Deciding the shape now — `frequency_overrides(surface, reading, rank)`, joined on surface+reading (not JMdict id, so expect homograph ambiguity), consulted by ranking when present — costs nothing and stops the eventual implementation from being a ranking rewrite. **No table ships until the import path does**; this is a note so the seam isn't designed into a corner.

## Evaluated and deliberately NOT doing

Recorded so it isn't re-litigated.

### Splitting `search_terms` by script

`search_terms` is two tables in a coat: **74% Latin rows** (gloss 99,616 + word 151,271 + romaji 27,573 + kanji_meaning 36,239 = 314,699) and **26% Japanese** (kanji 26,488 + kana 27,576 + char 48,459 + kanji_literal 10,384 = 112,907). Two full indexes cover all 427,606 rows, so every Japanese lookup traverses an index containing 315k English rows and vice versa. `term_lower` duplicates `term` in **424,262 / 427,606 rows (99.2%)**.

Splitting into `search_terms_ja` (indexed on `term`) and `search_terms_en` (indexed on `term_lower` only) would shrink both indexes and delete the duplication.

**Deferred, because the measurements do not justify it.** Post-optimization, `search` runs 1.9–2.4ms at limit=50 and every other path is under 1.1ms; index traversal is not the bottleneck. It is also the single most invasive change available — it touches the ranking SQL, the deinflection merge, `searchKanji`, and every build-side insert. Revisit **only** if full-DB measurements (which do not exist yet — see the unverified full-variant note in CONVENTIONS.md) show index size actually hurting. Note that [spec 05](05-asset-delivery.md) already costed the `term_lower` duplication as _text_ and called it not worth fixing; that analysis missed the index, which is the real expense — so the size argument is stronger than recorded there, and the latency argument is still weak.

### Indexing `kanji.text` / `kana.text`

No current query needs them now that lemma resolution routes through `search_terms`, and unused indexes are pure size. Documented in `schema.sql` instead, with `db.spec`'s index-shape test guarding the regression.

## As built

- **Tags as rows** — `sense_tags` 65,903 rows over 173 codes, `word_tags` 32,441. Four sense JSON columns and `priority_tags_json` dropped, along with `glosses.lang` and `senses.id`'s `AUTOINCREMENT`. `getWord`'s per-sense gloss query went with them.
- **`radicals.position`** — 251/253 classified. Two spec 04 corrections, both from checking the real `dictionaryJa.txt` rather than the quoted examples: its 国 string is truncated (the real entry repeats the split enclosure), and more seriously **Radkfile keys variant radicals by an exemplar kanji** (亻 as 化, ⻌ as 込), which no derivation from the key itself can bridge — AnimCJK marks 化's own radical as 匕. Deriving the component from a radical's MEMBERS instead took coverage from 184/253 to 251/253.
- **`kana.sort_key` + `search_terms.term_norm`** — one normalizer (`shared/kana.ts`), two keys. `term_norm` is populated for kana rows only (27,584 of 427,817) behind a partial index.

**Size correction:** this spec predicted the DB would not grow, and it did — the tags change alone was 91MB → 95MB. The error was costing the removed JSON at the 1.2MB measured for ALL sense JSON columns, when that figure included the four being kept; only ~0.9MB left, while ~98k new rows across two tables with two indexes each is ~4–5MB. Normalization's cost is structure, not data: the tag text itself is 0.14MB. Net across the whole spec is still 101MB → 97MB, because dropping `sentences.ja` removed a column from 133k existing rows, which is the cheap direction.

## Build order

1. `sense_tags` + `word_tags`, drop the four sense JSON columns and `priority_tags_json` — build, schema, both query layers, `getWord` display reconstruction.
2. `radicals.position` (spec 04's build step and DTO change — that spec owns the detail).
3. `kana.sort_key` + `search_terms.term_norm` from one shared normalizer.
4. `glosses.lang` and `senses.id AUTOINCREMENT` removal.
5. One `SCHEMA_VERSION` bump covering all of it; rebuild both variants; re-upload the release trio.

Steps 1–4 are independent and can land as separate commits, but **the version bump and rebuild happen once, at the end**. Landing them as five separate schema versions would mean five rebuilds and — after release — five forced re-downloads.

## Success criteria

- `db.spec`'s ranking assertions and `accuracy.spec`'s eval gate stay green throughout; they are the contract this refactor must not break.
- No query returns JSON to JavaScript in order to decide what to discard.
- A `#vulgar`-shaped query is an indexed lookup, demonstrable via the same probe method used for the `IN`/`prepare` findings (measure, don't assume).
- The DB does not grow: `sense_tags` + `word_tags` should be roughly offset by the dropped JSON columns and `glosses.lang`.
