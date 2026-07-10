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
  id        TEXT PRIMARY KEY,          -- JMdict entry id (e.g. "1358280")
  is_common INTEGER NOT NULL DEFAULT 0 -- 1 if any kanji/kana writing is "common"
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

-- Denormalized, indexed search surface. One row per searchable term of a word so a single
-- indexed lookup covers Japanese (kanji/kana), English (gloss), and Hepburn romaji input.
--   kind ∈ ('kanji', 'kana', 'gloss', 'romaji')
-- `term` holds the raw term; `term_lower` is a lowercased copy for case-insensitive gloss/romaji
-- matching (kanji/kana are unaffected by lowering).
CREATE TABLE search_terms (
  word_id    TEXT NOT NULL REFERENCES words(id),
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
