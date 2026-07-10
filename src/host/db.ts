/**
 * Host-side dictionary query layer. Opens the Turso/SQLite database and exposes typed,
 * async lookups that return the plain DTOs from `../shared/messages`. The UI never touches
 * SQL — it goes through the message protocol, which calls these.
 */
import { connect } from "@tursodatabase/database";
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

    // Composite relevance score, best-scoring term per word. Signals, strongest first:
    //   - match tier: exact > whole-word gloss match (word-boundary LIKEs; only ever fire on
    //     spaced latin glosses) > plain prefix > bare substring. This is what lifts 食べる
    //     ("to eat" ends with the word "eat") above compounds whose glosses merely contain "eat".
    //   - kind: a headword match (kanji/kana/romaji) outranks a gloss match at the same tier.
    //   - primary: the word's main surface (first writing/reading, or first gloss of the first
    //     sense) outranks the same match buried in a later gloss — this puts 水 first for "water".
    //   - common: a mild bonus, not the primary key.
    //   - length penalty (capped): shorter matched terms are closer matches, so 勉強 beats 勉強家.
    const rows = await this.#all<{
      word_id: string;
      score: number;
      common: number;
    }>(
      `SELECT word_id,
              MAX(
                CASE
                  WHEN ${column} = ?1 THEN 100
                  WHEN ${column} LIKE ?2 THEN 75
                  WHEN ${column} LIKE ?3 THEN 65
                  WHEN ${column} LIKE ?4 THEN 60
                  WHEN ${column} LIKE ?5 THEN 45
                  ELSE 10
                END
                + CASE WHEN kind = 'gloss' THEN 0 ELSE 15 END
                + CASE WHEN is_primary = 1 THEN 10 ELSE 0 END
                + CASE WHEN is_common = 1 THEN 5 ELSE 0 END
                - MIN(LENGTH(${column}) - LENGTH(?1), 15)
              ) AS score,
              MAX(is_common) AS common
         FROM search_terms
        WHERE ${column} LIKE ?6
        GROUP BY word_id
        ORDER BY score DESC, common DESC
        LIMIT ?7`,
      needle,
      `${needle} %`,
      `% ${needle}`,
      `% ${needle} %`,
      `${needle}%`,
      `%${needle}%`,
      limit
    );

    const results: SearchResultDto[] = [];
    for (const row of rows) {
      const preview = await this.#searchResult(row.word_id, row.common === 1);
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
