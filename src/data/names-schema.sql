-- Names dictionary schema (JMnedict). This is a SEPARATE database (`jisho-names.db`), an optional
-- download — JMnedict is ~743k entries and would roughly double the main DB. It mirrors the word
-- schema but simpler: a name has kanji/kana writings and one or more translations, each carrying
-- name-type tags (surname/place/given/company/…) and the romanized/English form. No senses, no POS.
--
-- Same engine constraints as the main DB (Turso/Limbo, no FTS5): search stays index-friendly —
-- exact + prefix range scans over a denormalized `name_search_terms`, never unanchored LIKE.

PRAGMA foreign_keys = ON;

-- One row per JMnedict entry.
CREATE TABLE name_words (
  id TEXT PRIMARY KEY -- JMnedict entry id (e.g. "5543705")
);

-- Kanji (non-kana) writings of a name.
CREATE TABLE name_kanji (
  word_id  TEXT NOT NULL REFERENCES name_words(id),
  position INTEGER NOT NULL,
  text     TEXT NOT NULL,
  PRIMARY KEY (word_id, position)
);

-- Kana readings of a name.
CREATE TABLE name_kana (
  word_id               TEXT NOT NULL REFERENCES name_words(id),
  position              INTEGER NOT NULL,
  text                  TEXT NOT NULL,
  applies_to_kanji_json TEXT NOT NULL DEFAULT '["*"]',
  PRIMARY KEY (word_id, position)
);

-- One row per translation (JMnedict's analogue of a sense, but flatter): the name-type tags and
-- the translation strings, both JSON arrays read whole when rendering a name's detail.
CREATE TABLE name_translations (
  word_id           TEXT NOT NULL REFERENCES name_words(id),
  position          INTEGER NOT NULL,
  types_json        TEXT NOT NULL DEFAULT '[]', -- name-type tag codes (surname, place, given…)
  translations_json TEXT NOT NULL DEFAULT '[]', -- English/romanized translation strings
  PRIMARY KEY (word_id, position)
);

CREATE INDEX idx_name_translations_word ON name_translations(word_id);

-- Name-type tag dictionary (surname → "family or surname", etc.), for human-readable badges.
CREATE TABLE name_tags (
  tag         TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

-- Denormalized, indexed search surface. One row per searchable term of a name (kanji text, kana
-- text, romaji of the reading, and each word of a translation) so a single indexed range scan
-- covers Japanese, romaji, and English lookups. Mirrors the main DB's `search_terms`.
--   kind ∈ ('kanji', 'kana', 'romaji', 'trans')
CREATE TABLE name_search_terms (
  word_id    TEXT NOT NULL REFERENCES name_words(id),
  kind       TEXT NOT NULL,
  term       TEXT NOT NULL,
  term_lower TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 -- 1 for the first kanji/kana writing (ranking boost)
);

CREATE INDEX idx_name_search_term       ON name_search_terms(term);
CREATE INDEX idx_name_search_term_lower ON name_search_terms(term_lower);

-- Build/attribution metadata (mirrors the main DB's meta table).
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
