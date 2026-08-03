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
import { CLASSIFIER_BY_ID, type Classifier } from "../../shared/classifiers";
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
 * For each classifier, how many words would REMAIN if it were added to the tags already applied.
 *
 * One grouped query rather than a count per candidate: the autocomplete offers ~90 tags and needs
 * every number at once to hide the ones that would narrow to zero. Counting them individually
 * would be 90 round trips per keystroke.
 *
 * With no tags applied this is just each classifier's own size, which is what the browse tree
 * shows — so `browseCounts` and this share a single code path rather than drifting.
 */
export const refineCounts = async (
  store: SqliteStore,
  applied: Classifier[]
): Promise<Record<string, number>> => {
  // The candidate pool: the words the applied tags leave. Empty `applied` means the whole
  // dictionary, and the SQL below then degenerates to a plain group-by over every word.
  const pool =
    applied.length === 0
      ? null
      : await (async (): Promise<Set<string>> => {
          const lists = await Promise.all(
            applied.map(async (c) => idsFor(store, c, "frequency", 100_000))
          );
          const [first, ...rest] = lists;
          const others = rest.map((l) => new Set(l.map((r) => r.id)));
          return new Set(
            first
              .filter((r) => others.every((s) => s.has(r.id)))
              .map((r) => r.id)
          );
        })();

  const counts: Record<string, number> = {};
  // Tag classifiers indexed by the (kind, code) they match, so one pass over `sense_tags` can
  // attribute each row without rescanning per classifier. Prefix families are kept separate
  // because they match by range rather than equality.
  const exact = new Map<string, Classifier[]>();
  const prefixes: Array<Extract<Classifier, { kind: "tag" }>> = [];
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (c.kind !== "tag") continue;
    if (c.prefix) prefixes.push(c);
    else {
      const key = `${c.tagKind}\t${c.code}`;
      exact.set(key, [...(exact.get(key) ?? []), c]);
    }
  }

  // One scan, counting DISTINCT words per classifier — a word with three `v5*` senses is one godan
  // verb, not three.
  const seen = new Map<string, Set<string>>();
  const rows = await store.all<{ kind: string; code: string; word_id: string }>(
    `SELECT t.kind AS kind, t.code AS code, s.word_id AS word_id
       FROM sense_tags t JOIN senses s ON s.id = t.sense_id`
  );
  for (const r of rows) {
    if (pool !== null && !pool.has(r.word_id)) continue;
    const hit = [
      ...(exact.get(`${r.kind}\t${r.code}`) ?? []),
      ...prefixes.filter(
        (c) => c.tagKind === r.kind && r.code.startsWith(c.code)
      )
    ];
    for (const c of hit) {
      const set = seen.get(c.id) ?? new Set<string>();
      set.add(r.word_id);
      seen.set(c.id, set);
    }
  }
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (c.kind === "tag") counts[c.id] = seen.get(c.id)?.size ?? 0;
  }

  // JLPT and frequency live on `words`, so they are counted from their own lists.
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (c.kind === "tag") continue;
    if (pool === null) {
      counts[c.id] = await browseCount(store, c);
    } else {
      const ids = await idsFor(store, c, "frequency", 100_000);
      counts[c.id] = ids.filter((r) => pool.has(r.id)).length;
    }
  }

  return counts;
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
