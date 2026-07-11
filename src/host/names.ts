/**
 * Host-side query layer for the optional JMnedict names database (`jisho-names.db`). A separate
 * class + connection from `Dictionary` because the names DB is a lazy, opt-in download — the word
 * dictionary must never wait on it. Mirrors `Dictionary`'s index-friendly search discipline (exact
 * + prefix range scans over `name_search_terms`, never unanchored LIKE) and typed read helpers.
 */
import { connect } from "@tursodatabase/database";
import type {
  NameDetailDto,
  NameResultDto,
  NameTranslationDto,
  TagDto
} from "../shared/messages";

type Db = Awaited<ReturnType<typeof connect>>;

export class NamesDictionary {
  #db: Db;
  #tags = new Map<string, string>();

  private constructor(db: Db) {
    this.#db = db;
  }

  static async open(path: string): Promise<NamesDictionary> {
    const db = await connect(path);
    const dict = new NamesDictionary(db);
    await dict.#loadTags();
    return dict;
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  async #loadTags(): Promise<void> {
    const rows = await this.#all<{ tag: string; description: string }>(
      "SELECT tag, description FROM name_tags"
    );
    for (const { tag, description } of rows) this.#tags.set(tag, description);
  }

  #tag(code: string): TagDto {
    return { code, description: this.#tags.get(code) ?? code };
  }

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
   * Search names by Japanese (kanji/kana), Hepburn romaji, or English translation. Index-friendly:
   * exact matches rank above prefix, primary (first) writings above later ones. Single-character
   * latin queries stay exact-only (a 1-letter prefix spans too much of the index).
   */
  async searchNames(rawQuery: string, limit = 20): Promise<NameResultDto[]> {
    const query = rawQuery.trim();
    if (query === "") return [];

    const isLatin = !/[^ -~]/.test(query);
    const column = isLatin ? "term_lower" : "term";
    const needle = isLatin ? query.toLowerCase() : query;
    const exactOnly = isLatin && needle.length < 2;
    const where = exactOnly
      ? `${column} = ?1`
      : `${column} >= ?1 AND ${column} < ?2`;

    const rows = await this.#all<{ word_id: string; score: number }>(
      `SELECT word_id,
              MAX(
                (CASE WHEN ${column} = ?1 THEN 100 ELSE 50 END)
                + CASE WHEN is_primary = 1 THEN 10 ELSE 0 END
              ) AS score
         FROM name_search_terms
        WHERE ${where}
        GROUP BY word_id
        ORDER BY score DESC
        LIMIT ?3`,
      ...(exactOnly ? [needle, needle, limit] : [needle, `${needle}￿`, limit])
    );

    const out: NameResultDto[] = [];
    for (const { word_id } of rows) {
      const preview = await this.#nameResult(word_id);
      if (preview) out.push(preview);
    }
    return out;
  }

  async #nameResult(id: string): Promise<NameResultDto | null> {
    const kanji = await this.#get<{ text: string }>(
      "SELECT text FROM name_kanji WHERE word_id = ? ORDER BY position LIMIT 1",
      id
    );
    const kana = await this.#get<{ text: string }>(
      "SELECT text FROM name_kana WHERE word_id = ? ORDER BY position LIMIT 1",
      id
    );
    const trans = await this.#get<{
      types_json: string;
      translations_json: string;
    }>(
      "SELECT types_json, translations_json FROM name_translations WHERE word_id = ? ORDER BY position LIMIT 1",
      id
    );

    const reading = kana?.text ?? "";
    const headword = kanji?.text ?? reading;
    if (headword === "") return null;
    const types = trans
      ? parseStrings(trans.types_json).map((c) => this.#tag(c).description)
      : [];
    const translations = trans ? parseStrings(trans.translations_json) : [];
    return {
      id,
      headword,
      reading: kanji ? reading : "", // no separate reading line for kana-only names
      types,
      translationPreview: translations[0] ?? ""
    };
  }

  /** Full detail for one name, or `null` if the id is unknown. */
  async getName(id: string): Promise<NameDetailDto | null> {
    const name = await this.#get<{ id: string }>(
      "SELECT id FROM name_words WHERE id = ?",
      id
    );
    if (!name) return null;

    const kanjiRows = await this.#all<{ text: string }>(
      "SELECT text FROM name_kanji WHERE word_id = ? ORDER BY position",
      id
    );
    const kanaRows = await this.#all<{ text: string }>(
      "SELECT text FROM name_kana WHERE word_id = ? ORDER BY position",
      id
    );
    const transRows = await this.#all<{
      types_json: string;
      translations_json: string;
    }>(
      "SELECT types_json, translations_json FROM name_translations WHERE word_id = ? ORDER BY position",
      id
    );

    const translations: NameTranslationDto[] = transRows.map((t) => ({
      types: parseStrings(t.types_json).map((c) => this.#tag(c)),
      translations: parseStrings(t.translations_json)
    }));

    return {
      id: name.id,
      kanji: kanjiRows.map((r) => r.text),
      kana: kanaRows.map((r) => r.text),
      translations
    };
  }
}

/** Parse a JSON-encoded string array from a DB column, tolerating malformed data. */
const parseStrings = (json: string): string[] => {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
};
