/**
 * Browsing the dictionary by classifier — the query half of #54, shared with `#tag` search (#27).
 *
 * A deliberately DIFFERENT query path from `search.ts`. Search ranks by relevance to a typed
 * string, which is a tuned composite score; browsing filters by a category and orders by something
 * a reader can navigate — frequency, or gojūon. Folding the two together would mean either ranking
 * a list that has no query to be relevant to, or diluting the search ranking with filter logic.
 * They share `searchResult`, so the ROWS cannot drift even though the queries differ.
 */
import type { SqliteStore } from "../store";
import type { Classifier } from "../../shared/classifiers";
import type { SearchResultDto } from "../../shared/messages";
import { searchResult } from "./search";

/** How a browsed list is ordered. */
export type BrowseOrder = "frequency" | "gojuon";

/**
 * The `words.id` set for a classifier, already ordered.
 *
 * Ordering happens in SQL rather than in the webview because the list can be thousands of rows and
 * the sort keys (`freq_rank`, `kana.sort_key`) are columns the DB already has — `sort_key` exists
 * precisely so gojūon ordering is an index-friendly ORDER BY rather than a JS collator over a
 * payload (#35).
 */
const idsFor = async (
  store: SqliteStore,
  classifier: Classifier,
  order: BrowseOrder,
  limit: number
): Promise<Array<{ id: string; common: number }>> => {
  // Gojūon reads the first kana row per word; frequency reads the word's own rank. Both put words
  // with no key last rather than dropping them — a word missing a frequency rank is still a word.
  const orderBy =
    order === "gojuon"
      ? `(SELECT sort_key FROM kana WHERE word_id = w.id ORDER BY position LIMIT 1)`
      : `w.freq_rank IS NULL, w.freq_rank`;

  if (classifier.kind === "jlpt") {
    return store.all<{ id: string; common: number }>(
      `SELECT w.id AS id, w.is_common AS common
         FROM words w
        WHERE w.jlpt = ?
        ORDER BY ${orderBy}
        LIMIT ?`,
      classifier.level,
      limit
    );
  }

  if (classifier.kind === "freq") {
    return store.all<{ id: string; common: number }>(
      `SELECT w.id AS id, w.is_common AS common
         FROM words w
        WHERE w.freq_rank IS NOT NULL AND w.freq_rank BETWEEN ? AND ?
        ORDER BY ${orderBy}
        LIMIT ?`,
      classifier.from,
      classifier.to,
      limit
    );
  }

  // Tag-backed. `prefix` covers the regular verb families, which JMdict stores one code per ending
  // (v5r, v5k, v5s…) with no umbrella code — a bare `v5` matches nothing. A half-open range keeps
  // it on `idx_sense_tags_code` rather than falling back to LIKE, which would scan.
  const { code, tagKind } = classifier;
  const match = classifier.prefix ? "t.code >= ? AND t.code < ?" : "t.code = ?";
  const args: Array<string | number> = classifier.prefix
    ? [tagKind, code, `${code}￿`]
    : [tagKind, code];
  return store.all<{ id: string; common: number }>(
    `SELECT DISTINCT w.id AS id, w.is_common AS common
       FROM sense_tags t
       JOIN senses s ON s.id = t.sense_id
       JOIN words w ON w.id = s.word_id
      WHERE t.kind = ? AND ${match}
      ORDER BY ${orderBy}
      LIMIT ?`,
    ...args,
    limit
  );
};

/**
 * The words in a classifier, as search-shaped rows.
 *
 * `limit` is generous rather than paged: the view virtualises, and a gojūon jump rail can only
 * offer a letter if the rows behind it are known. A capped-but-large list is the honest trade —
 * every category in the shipped dictionary fits well under it except the broadest POS ones.
 */
export const browse = async (
  store: SqliteStore,
  classifier: Classifier,
  order: BrowseOrder = "frequency",
  limit = 2000
): Promise<SearchResultDto[]> => {
  const rows = await idsFor(store, classifier, order, limit);
  const out: SearchResultDto[] = [];
  for (const row of rows) {
    const result = await searchResult(store, row.id, row.common === 1);
    if (result !== null) out.push(result);
  }
  return out;
};

/**
 * How many words a classifier holds, for the browse tree's counts.
 *
 * Counted rather than derived from `browse().length`, which is capped — a category showing "2000"
 * because that is the cap would be a lie, and the tree's whole job is telling you what is worth
 * opening.
 */
export const browseCount = async (
  store: SqliteStore,
  classifier: Classifier
): Promise<number> => {
  if (classifier.kind === "jlpt") {
    const row = await store.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM words WHERE jlpt = ?",
      classifier.level
    );
    return row?.n ?? 0;
  }
  if (classifier.kind === "freq") {
    const row = await store.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM words WHERE freq_rank BETWEEN ? AND ?",
      classifier.from,
      classifier.to
    );
    return row?.n ?? 0;
  }
  const { code, tagKind } = classifier;
  const match = classifier.prefix ? "t.code >= ? AND t.code < ?" : "t.code = ?";
  const args: Array<string | number> = classifier.prefix
    ? [tagKind, code, `${code}￿`]
    : [tagKind, code];
  const row = await store.get<{ n: number }>(
    `SELECT COUNT(DISTINCT s.word_id) AS n
       FROM sense_tags t JOIN senses s ON s.id = t.sense_id
      WHERE t.kind = ? AND ${match}`,
    ...args
  );
  return row?.n ?? 0;
};
