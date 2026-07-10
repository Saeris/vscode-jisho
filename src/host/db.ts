/**
 * Host-side dictionary query layer. Opens the Turso/SQLite database and exposes typed,
 * async lookups that return the plain DTOs from `../shared/messages`. The UI never touches
 * SQL — it goes through the message protocol, which calls these.
 */
import { connect } from "@tursodatabase/database";
import { isKana, toKana } from "wanakana";
import { deinflect } from "./deinflect";
import type {
  KanaDto,
  KanjiDto,
  SearchResultDto,
  SenseDto,
  TagDto,
  WordDetailDto
} from "../shared/messages";

type Db = Awaited<ReturnType<typeof connect>>;

/** Wraps an open database with prepared, hydrated queries. */
export class Dictionary {
  #db: Db;
  #tags = new Map<string, string>();

  private constructor(db: Db) {
    this.#db = db;
  }

  static async open(path: string): Promise<Dictionary> {
    const db = await connect(path);
    const dict = new Dictionary(db);
    await dict.#loadTags();
    return dict;
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  async #loadTags(): Promise<void> {
    const rows = await this.#all<{ tag: string; description: string }>(
      "SELECT tag, description FROM tags"
    );
    for (const { tag, description } of rows) this.#tags.set(tag, description);
  }

  #tag(code: string): TagDto {
    return { code, description: this.#tags.get(code) ?? code };
  }

  // Typed query helpers. Turso's `.get()`/`.all()` return `any`; funneling every read through
  // these two methods confines that single unavoidable boundary to one audited place and gives the
  // callers precise row types without scattered `as` assertions.
  async #all<T>(sql: string, ...params: Array<string | number>): Promise<T[]> {
    const stmt = await this.#db.prepare(sql);
    const rows: T[] = await stmt.all(...params);
    return rows;
  }

  async #get<T>(
    sql: string,
    ...params: Array<string | number>
  ): Promise<T | undefined> {
    const stmt = await this.#db.prepare(sql);
    const row: T | undefined = await stmt.get(...params);
    return row;
  }

  /**
   * Search by Japanese (kanji/kana), Hepburn romaji, or English (gloss) input. Results are ordered
   * by a composite relevance score (best-scoring term per word) so obvious answers surface first —
   * see the CASE tiers in the SQL. Latin queries are lowercased and matched against `term_lower`;
   * Japanese queries match `term` directly.
   */
  async search(rawQuery: string, limit = 50): Promise<SearchResultDto[]> {
    const query = rawQuery.trim();
    if (query === "") return [];

    // Latin (English/romaji) queries match case-insensitively against `term_lower`; any query
    // containing non-ASCII (kana/kanji) matches `term` directly. Testing for a non-ASCII char
    // avoids a control-character regex range.
    const isLatin = !/[^ -~]/.test(query);
    const column = isLatin ? "term_lower" : "term";
    const needle = isLatin ? query.toLowerCase() : query;

    // Composite relevance score, best-scoring term per word. Every tier is index-friendly — a
    // single range scan over [needle, needle+￿) — because unanchored LIKE full-scans took
    // 400ms–3s at full-dictionary scale (~3M term rows). Containment is precomputed at build time
    // instead: 'word' rows make whole-word gloss matches ("eat" in "to eat") exact hits, and
    // 'char' rows make kanji-containment (強 in 勉強) exact hits. Signals, strongest first:
    //   - exact headword (kanji/kana/romaji) > exact whole gloss > exact gloss word > kanji char;
    //     anything else in range is a prefix match, headwords boosted.
    //   - primary: the word's main surface (first writing/reading, or first gloss of the first
    //     sense) outranks the same match buried in a later gloss — this puts 水 first for "water".
    //   - common: a mild bonus, not the primary key.
    //   - length penalty (capped): shorter matched terms are closer matches, so 勉強 beats 勉強家.
    // Single-character latin queries stay exact-only: an "e%" range spans a huge slice of the
    // index and a 1-letter English prefix search is meaningless anyway.
    const exactOnly = isLatin && needle.length < 2;
    const where = exactOnly
      ? `${column} = ?1`
      : `${column} >= ?1 AND ${column} < ?2`;
    const rows = await this.#all<{
      word_id: string;
      score: number;
      common: number;
    }>(
      `SELECT word_id,
              MAX(
                CASE
                  WHEN ${column} = ?1 THEN
                    CASE kind
                      WHEN 'word' THEN 70
                      WHEN 'char' THEN 40
                      WHEN 'gloss' THEN 100
                      ELSE 115
                    END
                  ELSE
                    45 + CASE WHEN kind IN ('kanji', 'kana', 'romaji') THEN 15 ELSE 0 END
                END
                + CASE WHEN is_primary = 1 THEN 10 ELSE 0 END
                + CASE WHEN is_common = 1 THEN 5 ELSE 0 END
                - MIN(LENGTH(${column}) - LENGTH(?1), 15)
              ) AS score,
              MAX(is_common) AS common
         FROM search_terms
        WHERE ${where}
        GROUP BY word_id
        ORDER BY score DESC, common DESC
        LIMIT ?3`,
      ...(exactOnly ? [needle, needle, limit] : [needle, `${needle}￿`, limit])
    );

    // Deinflection pass: expand a conjugated query (はなします) into candidate dictionary forms
    // (はなす) and merge their *exact headword* matches. Romaji input is transliterated to kana
    // first ("hanashimasu" → はなします) — only when the transliteration is fully kana, so
    // English queries ("study") are never mangled. Candidates score below a literal exact match
    // (130) but above prefix/substring noise, so typing a real word exactly still wins.
    const candidates = new Set<string>();
    if (isLatin) {
      const kana: string = toKana(needle);
      if (isKana(kana)) {
        candidates.add(kana);
        for (const form of deinflect(kana)) candidates.add(form);
      }
    } else {
      for (const form of deinflect(needle)) candidates.add(form);
    }
    candidates.delete(needle);

    const merged = new Map<string, { score: number; common: number }>();
    for (const row of rows) {
      merged.set(row.word_id, { score: row.score, common: row.common });
    }
    if (candidates.size > 0) {
      const list = [...candidates];
      const deinflected = await this.#all<{ word_id: string; common: number }>(
        `SELECT word_id, MAX(is_common) AS common
           FROM search_terms
          WHERE kind IN ('kanji', 'kana')
            AND term IN (${list.map(() => "?").join(", ")})
          GROUP BY word_id
          LIMIT ?`,
        ...list,
        limit
      );
      for (const row of deinflected) {
        const score = 90 + (row.common === 1 ? 5 : 0);
        const existing = merged.get(row.word_id);
        if (!existing || existing.score < score) {
          merged.set(row.word_id, { score, common: row.common });
        }
      }
    }

    const ranked = [...merged.entries()]
      .sort((a, b) => b[1].score - a[1].score || b[1].common - a[1].common)
      .slice(0, limit);

    const results: SearchResultDto[] = [];
    for (const [wordId, { common }] of ranked) {
      const preview = await this.#searchResult(wordId, common === 1);
      if (preview) results.push(preview);
    }
    return results;
  }

  async #searchResult(
    id: string,
    common: boolean
  ): Promise<SearchResultDto | null> {
    const kanji = await this.#get<{ text: string }>(
      "SELECT text FROM kanji WHERE word_id = ? ORDER BY position LIMIT 1",
      id
    );
    const kana = await this.#get<{ text: string }>(
      "SELECT text FROM kana WHERE word_id = ? ORDER BY position LIMIT 1",
      id
    );
    const gloss = await this.#get<{ text: string }>(
      `SELECT g.text AS text
         FROM senses s JOIN glosses g ON g.sense_id = s.id
        WHERE s.word_id = ?
        ORDER BY s.position, g.position
        LIMIT 1`,
      id
    );

    const reading = kana?.text ?? "";
    const headword = kanji?.text ?? reading;
    if (headword === "") return null;
    return {
      id,
      headword,
      reading: kanji ? reading : "", // no separate reading line for kana-only words
      common,
      glossPreview: gloss?.text ?? ""
    };
  }

  /** Provenance/attribution key-values written by the data build (source, license, dictDate…). */
  async getMeta(): Promise<Record<string, string>> {
    const rows = await this.#all<{ key: string; value: string }>(
      "SELECT key, value FROM meta"
    );
    const meta: Record<string, string> = {};
    for (const { key, value } of rows) meta[key] = value;
    return meta;
  }

  /** Full detail for one entry, or `null` if the id is unknown. */
  async getWord(id: string): Promise<WordDetailDto | null> {
    const word = await this.#get<{ id: string; is_common: number }>(
      "SELECT id, is_common FROM words WHERE id = ?",
      id
    );
    if (!word) return null;

    const kanjiRows = await this.#all<{
      text: string;
      is_common: number;
      tags_json: string;
    }>(
      "SELECT text, is_common, tags_json FROM kanji WHERE word_id = ? ORDER BY position",
      id
    );
    const kanji: KanjiDto[] = kanjiRows.map((r) => ({
      text: r.text,
      common: r.is_common === 1,
      tags: parseStrings(r.tags_json)
    }));

    const kanaRows = await this.#all<{
      text: string;
      is_common: number;
      tags_json: string;
      applies_to_kanji_json: string;
    }>(
      `SELECT text, is_common, tags_json, applies_to_kanji_json
         FROM kana WHERE word_id = ? ORDER BY position`,
      id
    );
    const kana: KanaDto[] = kanaRows.map((r) => ({
      text: r.text,
      common: r.is_common === 1,
      tags: parseStrings(r.tags_json),
      appliesToKanji: parseStrings(r.applies_to_kanji_json)
    }));

    const senseRows = await this.#all<{
      id: number;
      pos_json: string;
      field_json: string;
      misc_json: string;
      info_json: string;
      dialect_json: string;
      applies_to_kanji_json: string;
      applies_to_kana_json: string;
      related_json: string;
      antonym_json: string;
    }>(
      `SELECT id, pos_json, field_json, misc_json, info_json, dialect_json,
              applies_to_kanji_json, applies_to_kana_json, related_json, antonym_json
         FROM senses WHERE word_id = ? ORDER BY position`,
      id
    );

    const senses: SenseDto[] = [];
    for (const s of senseRows) {
      const glossRows = await this.#all<{ text: string }>(
        "SELECT text FROM glosses WHERE sense_id = ? ORDER BY position",
        s.id
      );
      senses.push({
        partOfSpeech: parseStrings(s.pos_json).map((c) => this.#tag(c)),
        field: parseStrings(s.field_json).map((c) => this.#tag(c)),
        misc: parseStrings(s.misc_json).map((c) => this.#tag(c)),
        info: parseStrings(s.info_json),
        dialect: parseStrings(s.dialect_json).map((c) => this.#tag(c)),
        glosses: glossRows.map((g) => g.text),
        appliesToKanji: parseStrings(s.applies_to_kanji_json),
        appliesToKana: parseStrings(s.applies_to_kana_json),
        related: flattenXrefs(s.related_json),
        antonym: flattenXrefs(s.antonym_json)
      });
    }

    return { id: word.id, common: word.is_common === 1, kanji, kana, senses };
  }
}

/** Parse a JSON-encoded string array from a DB column, tolerating malformed data. */
const parseStrings = (json: string): string[] => {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
};

/**
 * JMdict xrefs are tuples like `["丸","まる",1]` / `["漢数字"]`, stored JSON-encoded. For M1 we
 * render just the leading surface term of each xref as a display string.
 */
const flattenXrefs = (json: string): string[] => {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (Array.isArray(x) && typeof x[0] === "string" ? x[0] : ""))
    .filter((s) => s !== "");
};
