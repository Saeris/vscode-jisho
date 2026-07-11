-- Jisho SQLite schema (single source of truth for the data build and host queries).
--
-- Design notes:
--  * The store is Turso/Limbo (SQLite-compatible), which does NOT implement SQLite's
--    FTS5 module. Search is therefore plain indexed LIKE/prefix over `search_terms`.
--  * JMdict's `appliesToKanji` / `appliesToKana` links are preserved as JSON columns so
--    the UI can honor them (a kana reading may apply to only *some* kanji spellings; a
--    naive kanji×kana cross-join produces wrong readings). "*" means "all".
--  * Rich, rarely-filtered arrays (tags, xrefs, pos lists) are stored as JSON text rather
--    than exploded into rows — they are read whole when rendering a single word's detail,
--    never queried across words in M1.
--  * `position` columns retain source ordering (JMdict order is meaningful for display).

PRAGMA foreign_keys = ON;

-- One row per JMdict entry.
CREATE TABLE words (
  id        TEXT PRIMARY KEY,           -- JMdict entry id (e.g. "1358280")
  is_common INTEGER NOT NULL DEFAULT 0, -- 1 if any kanji/kana writing is "common"
  jlpt      INTEGER                     -- word-level JLPT (5=N5 … 1=N1), null otherwise.
                                        -- Unofficial community estimate (Waller/tanos via
                                        -- stephenmk/yomitan-jlpt-vocab), joined by JMdict id.
);

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
  PRIMARY KEY (word_id, position)
);

-- One row per sense (meaning group) of a word.
CREATE TABLE senses (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id                TEXT NOT NULL REFERENCES words(id),
  position               INTEGER NOT NULL,
  pos_json               TEXT NOT NULL DEFAULT '[]', -- parts of speech (tag codes)
  field_json             TEXT NOT NULL DEFAULT '[]', -- fields of application
  misc_json              TEXT NOT NULL DEFAULT '[]',
  info_json              TEXT NOT NULL DEFAULT '[]',
  dialect_json           TEXT NOT NULL DEFAULT '[]',
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
  lang     TEXT NOT NULL DEFAULT 'eng',
  text     TEXT NOT NULL,
  PRIMARY KEY (sense_id, position)
);

-- JMdict tag dictionary: maps tag codes (e.g. "v1", "n") to human descriptions.
CREATE TABLE tags (
  tag         TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

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

-- Example sentences (Tanaka corpus via Tatoeba, embedded per sense in jmdict-examples-eng). One
-- row per (word, sense, example); `position` retains source order, and examples are capped per
-- sense at build time. Read whole when rendering a word's detail, never queried across words.
CREATE TABLE sentences (
  word_id        TEXT NOT NULL REFERENCES words(id),
  sense_position INTEGER NOT NULL, -- which sense of the word (matches senses.position)
  position       INTEGER NOT NULL, -- order within the sense
  ja             TEXT NOT NULL,
  en             TEXT NOT NULL,
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

-- Radical → the kanji built from it (Radkfile). Drives the radical picker; `kanji_json` is read
-- whole (never joined), so a JSON array column is fine.
CREATE TABLE radicals (
  radical      TEXT PRIMARY KEY,
  stroke_count INTEGER NOT NULL,
  kanji_json   TEXT NOT NULL DEFAULT '[]'
);

-- Kanji stroke-order animation SVGs (AnimCJK, Arphic Public License — see assets/kanji-svgs/).
-- One row per character; `svg` is the raw SVG markup, read whole (exact PK lookup) when the kanji
-- detail view plays the stroke animation. Only present for characters we have an SVG for.
CREATE TABLE stroke_svgs (
  literal TEXT PRIMARY KEY,
  svg     TEXT NOT NULL
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
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_search_term       ON search_terms(term);
CREATE INDEX idx_search_term_lower ON search_terms(term_lower);

-- Build/attribution metadata (source revisions, entry counts, dict date) as key/value.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
