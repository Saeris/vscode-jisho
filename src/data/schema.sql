-- Jisho SQLite schema (single source of truth for the data build and host queries).
--
-- Design notes:
--  * The store is Turso/Limbo (SQLite-compatible), which does NOT implement SQLite's
--    FTS5 module. Search is therefore plain indexed LIKE/prefix over `search_terms`.
--  * JMdict's `appliesToKanji` / `appliesToKana` links are preserved as JSON columns so
--    the UI can honor them (a kana reading may apply to only *some* kanji spellings; a
--    naive kanji×kana cross-join produces wrong readings). "*" means "all".
--  * The dividing line for arrays (spec 15): anything read as a PREDICATE is rows, anything read
--    only for DISPLAY may stay JSON. Tag codes are rows (`sense_tags`, `word_tags`) because POS
--    gates deinflection and #27 searches by code, and SQL cannot reach into a JSON string. Free
--    text and xrefs (info, related, antonym, applies_to_*) stay JSON — not a closed vocabulary,
--    never filtered on. A predicate needed per-word gets a column instead: see `words.is_uk`.
--  * `position` columns retain source ordering (JMdict order is meaningful for display).
--  * `kanji.text` / `kana.text` are deliberately NOT indexed: `search_terms` is the ONLY lookup
--    surface for finding a word by its writing or reading. Querying those columns directly gets a
--    full scan of the join product (it cost a flat 283ms on the hover path before being routed
--    through `search_terms`); db.spec's index-shape test guards the regression.

PRAGMA foreign_keys = ON;

-- One row per JMdict entry.
CREATE TABLE words (
  id        TEXT PRIMARY KEY,           -- JMdict entry id (e.g. "1358280")
  is_common INTEGER NOT NULL DEFAULT 0, -- 1 if any kanji/kana writing is "common"
  jlpt      INTEGER,                    -- word-level JLPT (5=N5 … 1=N1), null otherwise.
                                        -- Unofficial community estimate (Waller/tanos via
                                        -- stephenmk/yomitan-jlpt-vocab), joined by JMdict id.
  -- Frequency rank from JMdict's own nfXX priority tags: 1 = among the 500 most frequent words,
  -- 2 = the next 500, … (~48 buckets over the top ~24,000). NULL = outside that set. Read from the
  -- original JMdict XML because jmdict-simplified discards the *_pri fields, keeping only the
  -- boolean `common` — without this gradient every exact match ties and ranking is arbitrary.
  -- Source corpus is the Mainichi Shimbun wordfreq file, so it has a newspaper's skew (BACKLOG #26).
  freq_rank INTEGER,
  -- 1 when ANY sense carries JMdict's `uk` misc tag ("usually written using kana alone"). Every
  -- query that wants this asks it of the WORD, so it is denormalized here rather than derived per
  -- sense: it drives whether a result leads with its kana or its kanji heading, and it floats
  -- 為る above 擦る in lemma resolution (freq_rank is backwards for usually-kana words). Was three
  -- correlated `misc_json LIKE '%"uk"%'` subqueries; `sense_tags` still carries the code itself for
  -- display. True for ~6% of senses.
  is_uk INTEGER NOT NULL DEFAULT 0,
  -- Gojūon collation key of the word's FIRST kana reading, denormalized from `kana.sort_key`.
  --
  -- Browsing a category orders by reading, and reaching that through `kana` costs a correlated
  -- subquery per candidate row — which SQLite must run for EVERY match before LIMIT applies. On the
  -- full dictionary that is 189,798 rows for "Nouns" alone: measured at ~2s per browse, and
  -- identical at LIMIT 10 and LIMIT 2000, because the ordering is the whole cost. Denormalizing
  -- lets `idx_words_sort` answer the ORDER BY directly. Empty string for a word with no kana row,
  -- so it sorts last rather than dropping out of an ORDER BY.
  sort_key  TEXT NOT NULL DEFAULT ''
);

-- Ranking scans words by frequency; NULLs (the majority) are excluded by the partial index so it
-- stays small.
CREATE INDEX idx_words_freq ON words(freq_rank) WHERE freq_rank IS NOT NULL;

-- Browsing a category in gojūon order (#54). Without this the ORDER BY builds a temp B-tree over
-- every word in the category before LIMIT can apply.
CREATE INDEX idx_words_sort ON words(sort_key);

-- Kanji (non-kana-only) writings of a word.
CREATE TABLE kanji (
  word_id   TEXT NOT NULL REFERENCES words(id),
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL,
  is_common INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (word_id, position)
);

-- Kana readings of a word.
CREATE TABLE kana (
  word_id                TEXT NOT NULL REFERENCES words(id),
  position               INTEGER NOT NULL,
  text                   TEXT NOT NULL,
  is_common              INTEGER NOT NULL DEFAULT 0,
  tags_json              TEXT NOT NULL DEFAULT '[]',
  applies_to_kanji_json  TEXT NOT NULL DEFAULT '["*"]', -- which kanji writings this reading applies to
  -- 五十音順 collation key (BACKLOG #35): codepoint order over kana is meaningless for Japanese, and
  -- browseable lists (a kanji's words, name results, picker matches) are read like an index. Built
  -- by shared/kana.ts's sortKey — the fold orders, the marks it removed follow as a tiebreak so
  -- はし and ばし stay distinct. Hiragana codepoints already run in gojūon order, so plain string
  -- comparison on this column is correct; no database collation support is needed.
  sort_key               TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (word_id, position)
);

-- One row per sense (meaning group) of a word.
CREATE TABLE senses (
  id                     INTEGER PRIMARY KEY,
  word_id                TEXT NOT NULL REFERENCES words(id),
  position               INTEGER NOT NULL,
  info_json              TEXT NOT NULL DEFAULT '[]', -- free-text notes, not codes
  applies_to_kanji_json  TEXT NOT NULL DEFAULT '["*"]',
  applies_to_kana_json   TEXT NOT NULL DEFAULT '["*"]',
  related_json           TEXT NOT NULL DEFAULT '[]', -- xrefs
  antonym_json           TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_senses_word ON senses(word_id);

-- English glosses (translations) belonging to a sense.
CREATE TABLE glosses (
  sense_id INTEGER NOT NULL REFERENCES senses(id),
  position INTEGER NOT NULL,
  text     TEXT NOT NULL,
  PRIMARY KEY (sense_id, position)
);

-- JMdict tag dictionary: maps tag codes (e.g. "v1", "n") to human descriptions.
CREATE TABLE tags (
  tag         TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

-- JMdict tag codes as ROWS, not JSON arrays (spec 15). These are read as PREDICATES — POS decides
-- whether a deinflection candidate is grammatically possible, and BACKLOG #27's tag search (#vulgar,
-- #n5) filters by them across every word — and SQL cannot reach into a JSON string. They used to be
-- `pos_json`/`misc_json`/`field_json`/`dialect_json`, group_concat'd and parsed in JavaScript to
-- decide which rows to throw away.
--
-- Small: ~66k rows over ~173 distinct codes, against search_terms' ~428k. `code` leads the index
-- because tag search looks up BY code. Free-text and xref arrays (info, related, antonym,
-- applies_to_*) stay JSON — they are not codes from a closed vocabulary and are never predicates.
CREATE TABLE sense_tags (
  sense_id INTEGER NOT NULL REFERENCES senses(id),
  kind     TEXT NOT NULL, -- 'pos' | 'misc' | 'field' | 'dialect'
  code     TEXT NOT NULL, -- JMdict tag code, joinable to tags.tag
  PRIMARY KEY (sense_id, kind, code)
);

CREATE INDEX idx_sense_tags_code ON sense_tags(code, kind);

-- Word-level priority tags (news1, ichi1, spec1, gai1…), same rationale: #27 wants them as both
-- display badges and search targets. Unioned across the entry's writings/readings by the build.
CREATE TABLE word_tags (
  word_id TEXT NOT NULL REFERENCES words(id),
  code    TEXT NOT NULL,
  PRIMARY KEY (word_id, code)
);

CREATE INDEX idx_word_tags_code ON word_tags(code);

-- Pitch accent (Kanjium): mora-position accent pattern(s) per (word, reading). `accents_json` is
-- a JSON array of mora numbers (0=heiban/flat, n=downstep after mora n), ordered by commonness;
-- read whole when rendering a word's readings, never queried across words. Keyed by (word_id,
-- reading) because a word's readings can differ in accent. Unofficial-adjacent but well-sourced
-- (NHK/Wadoku via Kanjium); imperfect JMdict join coverage is expected.
CREATE TABLE pitch_accents (
  word_id      TEXT NOT NULL REFERENCES words(id),
  reading      TEXT NOT NULL,
  accents_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (word_id, reading)
);

-- Example sentences from two sources, unified in one table (see docs/specs/05, F1):
--   * source='tanaka'  — the curated per-sense examples embedded in jmdict-examples-eng (Jim Breen's
--     JMdict <ex_srce> links). ~1/sense; these are the accurate INLINE example shown under a sense.
--   * source='tatoeba' — the fuller Tatoeba jpn corpus, joined at build time via jpn_indices. These
--     populate the "more examples" page. `sense_position` carries the B-line [NN] sense number when
--     it resolved in-range, else the word-level sentinel -1 (the token had no sense tag or it was
--     out of range) — so the pool is sense-aware where the data allows and word-level otherwise.
-- `position` retains source order within its (word, sense_position) group; both sources are capped
-- at build time. `tatoeba_id` is the Tatoeba sentence id, kept for provenance and to dedup a pool
-- sentence against the inline one already shown for that sense. `ja_furigana` is the Japanese text
-- pre-annotated with mirrordown ruby ({漢字|かんじ}) at build time. Read whole when rendering a
-- word's detail, never queried across words.
--
-- There is no plain `ja` column: it is `stripRubyText(ja_furigana)`, so storing it duplicated 2.8MB
-- and let the two disagree. Each source also only ever read one of them (inline sentences render
-- plain, the pool page renders furigana), so both columns were dead weight on the other's rows.
CREATE TABLE sentences (
  word_id        TEXT NOT NULL REFERENCES words(id),
  sense_position INTEGER NOT NULL, -- sense index (matches senses.position); -1 = word-level pool
  position       INTEGER NOT NULL, -- order within the (word, sense_position) group
  ja_furigana    TEXT NOT NULL,    -- Japanese with build-time ruby markup ({漢字|かんじ})
  en             TEXT NOT NULL,
  tatoeba_id     INTEGER,          -- Tatoeba sentence id (provenance + dedup); null if unknown
  source         TEXT NOT NULL DEFAULT 'tanaka', -- 'tanaka' (inline) | 'tatoeba' (pool)
  PRIMARY KEY (word_id, sense_position, position)
);

CREATE INDEX idx_sentences_word ON sentences(word_id);

-- ── Kanji (Kanjidic2 + Kradfile/Radkfile) ──────────────────────────────────
-- Defined before `search_terms` because kanji-entry term rows FK-reference `kanji_characters`.
-- One row per kanji character. Readings/meanings/nanori are JSON arrays read whole when
-- rendering a single kanji's detail, never queried across characters.
CREATE TABLE kanji_characters (
  literal       TEXT PRIMARY KEY,             -- the character itself
  grade         INTEGER,                      -- school grade (1-6, 8=secondary, 9-10=jinmeiyo)
  stroke_count  INTEGER,                      -- accepted count (Kanjidic misc.strokeCounts[0])
  frequency     INTEGER,                      -- newspaper frequency rank (1..2500), null otherwise
  jlpt          INTEGER,                      -- old-scale JLPT level 1-4, null otherwise
  -- Modern N5-N1 level (stored 5..1, matching `words.jlpt`'s direction), null when unlisted.
  -- SEPARATE from `jlpt` above because the two scales are different data, not different encodings:
  -- the pre-2010 four-level scale does not map onto N5-N1 arithmetically (水 4→N5 and 私 3→N4 shift
  -- by one, but 顔 3→N3 does not), so overwriting would silently corrupt whichever consumer wanted
  -- the other one. Sourced from tanos.co.uk via onlyskin/kanjiapi — the same author as the
  -- word-level lists in `words.jlpt`.
  jlpt_n        INTEGER,
  on_json       TEXT NOT NULL DEFAULT '[]',   -- on'yomi readings (katakana)
  kun_json      TEXT NOT NULL DEFAULT '[]',   -- kun'yomi readings (hiragana, with okurigana dots)
  meanings_json TEXT NOT NULL DEFAULT '[]',   -- English meanings, in source order
  nanori_json   TEXT NOT NULL DEFAULT '[]'    -- name-only readings
);

-- Kanji → its components/radicals (Kradfile). One row per component.
CREATE TABLE kanji_components (
  literal   TEXT NOT NULL REFERENCES kanji_characters(literal),
  component TEXT NOT NULL,
  PRIMARY KEY (literal, component)
);

CREATE INDEX idx_components_component ON kanji_components(component);

-- Visually-similar kanji (F3), PRECOMPUTED at build time so the runtime read is a plain lookup. No
-- redistributable similar-kanji dataset exists (WaniKani's is proprietary — we only link it), so this
-- is DERIVED from shared Kradfile components, weighted to suppress the noise of raw overlap: shared
-- rare components count more (IDF), and candidates with a similar part-count and stroke-count score
-- higher (未/末 look alike; 未/魅 share a component but 魅 has far more parts). It is a deterministic,
-- offline approximation, not curated data — surfaced as a "you might be confusing these" aid.
-- `position` is the rank (0 = most similar); the top few per kanji are kept.
CREATE TABLE similar_kanji (
  literal  TEXT NOT NULL REFERENCES kanji_characters(literal),
  similar  TEXT NOT NULL REFERENCES kanji_characters(literal),
  position INTEGER NOT NULL,
  PRIMARY KEY (literal, position)
);

CREATE INDEX idx_similar_kanji_literal ON similar_kanji(literal);

-- Recursive component tree (cjk-decomp, amake fork — Apache-2.0/MIT multi-licence). Unlike Kradfile
-- (a flat set of atoms), this is HIERARCHICAL: it records each character's DIRECT children, so
-- 願 → 原 + 頁, 原 → 厂 …, giving the intermediate nodes Kradfile omits — the Jisho-style breakdown.
-- Adjacency rows, not a serialised tree: a subtree like 目 is shared by thousands of kanji, so
-- storing edges keeps it once and the host reconstructs the tree by walking from the root.
-- Pruned at build time to children that exist in kanji_characters (which is also the set we can
-- annotate with meanings/readings), dropping cjk-decomp's stroke-primitive and PUA leaves.
CREATE TABLE component_tree (
  literal  TEXT NOT NULL REFERENCES kanji_characters(literal), -- the parent character
  child    TEXT NOT NULL REFERENCES kanji_characters(literal), -- one direct component of it
  position INTEGER NOT NULL,                                   -- left-to-right order from the IDS
  PRIMARY KEY (literal, position)
);

-- Radical → the kanji built from it (Radkfile). Drives the radical picker; `kanji_json` is read
-- whole (never joined), so a JSON array column is fine.
CREATE TABLE radicals (
  radical      TEXT PRIMARY KEY,
  stroke_count INTEGER NOT NULL,
  kanji_json   TEXT NOT NULL DEFAULT '[]',
  -- One of the seven positional categories the Kanji Look & Learn textbook teaches — hen (left),
  -- tsukuri (right), kanmuri (top), ashi (bottom), kamae (enclosure), tare (upper-left), nyo
  -- (lower-left) — so the picker can filter the way learners are taught (spec 04). Derived from
  -- AnimCJK's `acjk` geometry by MAJORITY VOTE across every kanji that marks this radical: a
  -- radical's position is nearly always fixed (亻 is always hen), and the vote absorbs the odd
  -- irregular entry. NULL where no kanji votes — ~6% of entries mark the character as its own
  -- radical (見 IS Kangxi #147), which is a real distinction, not missing data.
  position     TEXT
);

-- Denormalized, indexed search surface. One row per searchable term of a word OR a kanji so a
-- single indexed range scan covers Japanese (kanji/kana), English (gloss), and Hepburn romaji.
--   kind ∈ ('kanji', 'kana', 'gloss', 'romaji', 'word', 'char',  -- word entries
--           'kanji_literal', 'kanji_meaning')                    -- kanji entries (M4)
-- 'word' rows index each word of each gloss ("eat" from "to eat") and 'char' rows index each CJK
-- character of each kanji writing (強 from 勉強), so whole-word and containment matches are exact
-- index hits — unanchored LIKE scans are too slow at full-dictionary scale (~3M rows).
-- A row references EITHER a word (`word_id`) or a kanji character (`kanji`), never both. The
-- vocabulary-ranking CASE keys off `kind`, so the kanji kinds don't perturb word ranking.
-- `term` holds the raw term; `term_lower` is a lowercased copy for case-insensitive gloss/romaji
-- matching (kanji/kana are unaffected by lowering).
CREATE TABLE search_terms (
  word_id    TEXT REFERENCES words(id),      -- null for kanji-entry rows
  kanji      TEXT REFERENCES kanji_characters(literal), -- null for word-entry rows
  kind       TEXT NOT NULL,
  term       TEXT NOT NULL,
  term_lower TEXT NOT NULL,
  is_common  INTEGER NOT NULL DEFAULT 0,
  -- 1 when this term is the word's primary surface: its first kanji writing, first kana reading
  -- (and that reading's romaji), or the first gloss of the first sense. Ranking boosts primary
  -- terms so a word whose *main* meaning matches outranks one where the match is buried.
  is_primary INTEGER NOT NULL DEFAULT 0,
  -- For gloss/word rows: how many glosses share this term's sense. A specificity signal — 食べる's
  -- first sense is just "to eat" (breadth 1), while 喫する's is "to eat, to drink, to smoke, to
  -- take" (breadth 4), so "eat" is a far weaker signal for 喫する. Both list "to eat" as sense 0
  -- gloss 0, so `is_primary` cannot separate them and frequency actively misleads (喫する is the
  -- more common NEWSPAPER word). Essentially IDF within a sense: a term sharing its sense with many
  -- near-synonyms is a less specific match. 1 for non-gloss rows (a writing/reading stands alone).
  sense_breadth INTEGER NOT NULL DEFAULT 1,
  -- Folded kana for error-tolerant matching; NULL for every non-kana kind (see the index below).
  term_norm TEXT
);

CREATE INDEX idx_search_term       ON search_terms(term);
CREATE INDEX idx_search_term_lower ON search_terms(term_lower);
-- Aggressively folded kana (BACKLOG #51): script, kana size, voicing and the long-vowel mark all
-- collapse, so a learner's plausible misspelling still lands on the word. Populated for kana rows
-- ONLY — kanji "typos" are a visual-similarity problem (the F3 data), not a normalization one, and
-- romaji tolerance is edit-distance. The partial index keeps it to those ~28k rows rather than 428k.
CREATE INDEX idx_search_term_norm  ON search_terms(term_norm) WHERE term_norm IS NOT NULL;

-- How many words each browse classifier holds, precomputed (#27/#54).
--
-- The browse tree shows ~90 counts at once and the tag autocomplete needs all of them to hide
-- combinations that would narrow to zero — so this is asked constantly and never changes between
-- dictionary builds. Deriving it at runtime meant scanning all 406,028 `sense_tags` rows, measured
-- at ~2s on the full dictionary.
--
-- Only the UNFILTERED counts live here. Refining counts (how many remain once other tags are
-- applied) still have to be computed live, because the combinations are unbounded — but that is the
-- rarer case and is cached per applied-set in the webview.
--
-- The classifier ids are the extension's own (`shared/classifiers.ts`), not the dataset's, so this
-- table is a CACHE of something code defines: an id here that the code no longer knows is ignored,
-- and an id the code knows that is missing here falls back to the live count. That keeps adding a
-- category a code-only change rather than one requiring a data rebuild.
CREATE TABLE classifier_counts (
  classifier_id TEXT PRIMARY KEY,
  n             INTEGER NOT NULL
);

-- Build/attribution metadata (source revisions, entry counts, dict date) as key/value.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
