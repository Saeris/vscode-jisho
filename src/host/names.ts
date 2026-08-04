/**
 * Host-side query layer for the optional JMnedict names database (`jisho-names.db`). A separate
 * class + connection from `Dictionary` because the names DB is a lazy, opt-in download — the word
 * dictionary must never wait on it. Mirrors `Dictionary`'s index-friendly search discipline (exact
 * + prefix range scans over `name_search_terms`, never unanchored LIKE) and typed read helpers.
 */
import { SqliteStore } from "./store";
import type {
  NameDetailDto,
  NameResultDto,
  NameTranslationDto,
  TagDto
} from "../shared/messages";

export class NamesDictionary {
  #store: SqliteStore;

  private constructor(store: SqliteStore) {
    this.#store = store;
  }

  static async open(path: string): Promise<NamesDictionary> {
    const store = await SqliteStore.open(path);
    await store.loadTags("name_tags");
    return new NamesDictionary(store);
  }

  async close(): Promise<void> {
    await this.#store.close();
  }

  // Delegates to the shared store — see src/host/store.ts for why these are not implemented twice.
  async #all<T>(sql: string, ...params: Array<string | number>): Promise<T[]> {
    return this.#store.all<T>(sql, ...params);
  }

  async #get<T>(
    sql: string,
    ...params: Array<string | number>
  ): Promise<T | undefined> {
    return this.#store.get<T>(sql, ...params);
  }

  #tag(code: string): TagDto {
    return this.#store.tag(code);
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

  /**
   * Browse names by type (`#name` / `#place`, #27).
   *
   * `place` is the largest category in JMnedict by a wide margin — 227,434 of 743,456 entries —
   * and `#name` deliberately EXCLUDES it: a reader asking for names wants people and organisations,
   * and letting places dominate that list would make the tag useless for its own purpose. The two
   * tags partition the dictionary rather than nesting.
   *
   * Ordered by id, which is JMnedict's own sequence — there is no frequency ranking for names, and
   * a reading-ordered list would need the same `sort_key` column the word DB has and this one does
   * not. Stable and arbitrary beats unstable.
   */
  async browseNames(
    kind: "name" | "place",
    limit = 2000
  ): Promise<NameResultDto[]> {
    // `types_json` is a JSON array, matched with LIKE rather than parsed: 744k rows is too many to
    // pull into JS, and the alternative — a normalised type table — is a schema change for one
    // query. The pattern cannot false-positive, since no other type code contains "place".
    const match =
      kind === "place"
        ? "t.types_json LIKE '%\"place\"%'"
        : "t.types_json NOT LIKE '%\"place\"%'";
    const rows = await this.#all<{ word_id: string }>(
      `SELECT DISTINCT t.word_id AS word_id
         FROM name_translations t
        WHERE ${match}
        ORDER BY t.word_id
        LIMIT ?`,
      limit
    );
    const out: NameResultDto[] = [];
    for (const { word_id } of rows) {
      const result = await this.#nameResult(word_id);
      if (result) out.push(result);
    }
    return out;
  }

  /** How many names a type holds, for the browse tree's counts. */
  async browseNamesCount(kind: "name" | "place"): Promise<number> {
    const match =
      kind === "place"
        ? "types_json LIKE '%\"place\"%'"
        : "types_json NOT LIKE '%\"place\"%'";
    const row = await this.#get<{ n: number }>(
      `SELECT COUNT(DISTINCT word_id) AS n FROM name_translations WHERE ${match}`
    );
    return row?.n ?? 0;
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
