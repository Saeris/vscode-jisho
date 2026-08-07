/**
 * Browsing the dictionary by classifier — the query half of #54, shared with `#tag` search (#27).
 *
 * A deliberately DIFFERENT query path from `search.ts`. Search ranks by relevance to a typed
 * string, which is a tuned composite score; browsing filters by a category and orders by something
 * a reader can navigate — frequency, or gojūon. Folding the two together would mean either ranking
 * a list that has no query to be relevant to, or diluting the search ranking with filter logic.
 * They share `searchResults`, so the ROWS cannot drift even though the queries differ.
 */
import type { SqliteStore } from "../store";
import {
  CLASSIFIER_BY_ID,
  KANJI_LIST_FILTERS,
  type Classifier,
  type KanjiListId
} from "../../shared/classifiers";
import type { KanjiResultDto, SearchResultDto } from "../../shared/messages";
import { kanjiResults, searchResults } from "./search";

/** How a browsed list is ordered. */
export type BrowseOrder = "frequency" | "gojuon";

/**
 * The `words.id` set for a classifier, already ordered.
 *
 * Ordering happens in SQL rather than in the webview because the list can be thousands of rows and
 * both sort keys (`freq_rank`, `sort_key`) are indexed columns ON `words` — `sort_key` exists
 * precisely so gojūon ordering is an index-friendly ORDER BY rather than a JS collator over a
 * payload (#35), and it is denormalized onto the word rather than reached through `kana` so the
 * ORDER BY can stop at LIMIT instead of scanning the whole category.
 */
const idsFor = async (
  store: SqliteStore,
  classifier: Classifier,
  order: BrowseOrder,
  limit: number
): Promise<Array<{ id: string; common: number }>> => {
  // Gojūon reads the first kana row per word; frequency reads the word's own rank. Both put words
  // with no key last rather than dropping them — a word missing a frequency rank is still a word.
  // `w.sort_key`, denormalized onto `words` at build time, NOT a subquery into `kana`. The
  // correlated form made SQLite evaluate it for every candidate row before LIMIT could apply —
  // measured at ~2s for "Nouns" on the full dictionary, and identical at LIMIT 10, because the
  // ordering was the entire cost. `idx_words_sort` now answers it directly.
  const orderBy =
    order === "gojuon" ? `w.sort_key` : `w.freq_rank IS NULL, w.freq_rank`;

  // A result-type filter selects WHICH KIND of thing comes back, not which words. `#word` is the
  // whole word set (it only narrows in combination with a non-word type, where the intersection is
  // empty by definition); every other type is answered elsewhere, by a query that returns kanji or
  // names rather than words.
  if (classifier.kind === "result") {
    if (classifier.result !== "word") return [];
    return store.all<{ id: string; common: number }>(
      `SELECT w.id AS id, w.is_common AS common
         FROM words w
        ORDER BY ${orderBy}
        LIMIT ?`,
      limit
    );
  }

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
  // Hydrated in ONE query rather than per row — `idsFor` has already put them in the order the
  // reader sees, and `searchResults` preserves it.
  return searchResults(
    store,
    rows.map((r) => ({ id: r.id, common: r.common === 1 }))
  );
};

/**
 * The kanji in a result-type classifier (`#kanji`), ordered for browsing.
 *
 * Ordered by newspaper `frequency` then stroke count, NOT by the word orderings above: a kanji has
 * no reading to sort gojūon by, and the two useful axes for a character list are "how often will I
 * meet this" and "how complex is it". Kanji with no frequency rank sort last rather than being
 * dropped — an unranked character is still a character.
 */
export const browseKanji = async (
  store: SqliteStore,
  classifier: Classifier,
  limit = 2000
): Promise<KanjiResultDto[]> => {
  if (classifier.kind !== "result" || classifier.result !== "kanji") return [];
  const rows = await store.all<{ literal: string }>(
    `SELECT literal FROM kanji_characters
      ORDER BY frequency IS NULL, frequency, stroke_count
      LIMIT ?`,
    limit
  );
  return kanjiResults(
    store,
    rows.map((r) => r.literal)
  );
};

/**
 * The kanji in one browse list (#55) — a JLPT level, a school grade, or the frequency-ranked set.
 *
 * Ordered exactly like `browseKanji` above, and for the same reason: a kanji has no reading to sort
 * gojūon by, so frequency-then-strokes is the ordering a character list actually wants.
 *
 * The filter is chosen from a fixed set rather than taking a caller-supplied predicate, so the SQL
 * stays a parameterised lookup on an indexed column and there is no path for a browse id to become
 * a query fragment.
 */
export const browseKanjiList = async (
  store: SqliteStore,
  list: KanjiListId,
  limit = 3000
): Promise<KanjiResultDto[]> => {
  const where = KANJI_LIST_FILTERS[list];
  const rows = await store.all<{ literal: string }>(
    `SELECT literal FROM kanji_characters
      WHERE ${where.sql}
      ORDER BY frequency IS NULL, frequency, stroke_count
      LIMIT ?`,
    ...where.params,
    limit
  );
  return kanjiResults(
    store,
    rows.map((r) => r.literal)
  );
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
  // Nothing applied — the overwhelmingly common case (the browse tree, and the first tag typed).
  // Read the counts the BUILD precomputed rather than deriving them: the live derivation scans all
  // 406,028 `sense_tags` rows, measured at ~2s on the full dictionary, for an answer that cannot
  // change until the next dictionary build.
  //
  // A classifier the build did not know (added in code since) is simply absent, and falls through
  // to the live path below — which is what keeps adding a category a code-only change.
  if (applied.length === 0) {
    const rows = await store.all<{ classifier_id: string; n: number }>(
      "SELECT classifier_id, n FROM classifier_counts"
    );
    if (rows.length > 0) {
      const cached: Record<string, number> = {};
      for (const r of rows) cached[r.classifier_id] = r.n;
      const missing = [...CLASSIFIER_BY_ID.values()].filter(
        (c) =>
          !(c.id in cached) &&
          // Name types are never in this table — the word build cannot count them, and the host
          // supplies them separately.
          !(
            c.kind === "result" &&
            (c.result === "name" || c.result === "place")
          )
      );
      if (missing.length === 0) return cached;
    }
  }

  // The candidate pool: the words the applied WORD filters leave. Result-type filters are excluded
  // — they select a kind of result rather than narrowing words, and `idsFor` returns nothing for
  // the non-word ones, which would empty the pool and zero every count.
  const wordFilters = applied.filter((c) => c.kind !== "result");
  const pool =
    wordFilters.length === 0
      ? null
      : await (async (): Promise<Set<string>> => {
          const lists = await Promise.all(
            wordFilters.map(async (c) => idsFor(store, c, "frequency", 100_000))
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

  // One pass, counting DISTINCT words per classifier — a word with three `v5*` senses is one godan
  // verb, not three.
  //
  // GROUPED IN SQL rather than scanned row-by-row in JS. The ungrouped form pulled all 406,028
  // rows across the boundary to count ~90 things, which was most of the ~2s this used to take; the
  // grouped form returns one row per (kind, code, word) that a classifier could possibly match,
  // and when a pool is present it is restricted to those words in SQL too.
  const seen = new Map<string, Set<string>>();
  // Bound the IN-list: SQLite caps bound parameters (999 by default, 32k when raised), and a broad
  // filter like "Nouns" leaves ~190k words. Past the cap the unrestricted query plus a JS filter is
  // the fallback — slower, but correct, and it only happens for filters so broad that the counts
  // they produce are barely narrowing anything anyway.
  const poolIds = pool === null || pool.size > 900 ? [] : [...pool];
  const restricted = poolIds.length > 0;
  const rows = await store.all<{ kind: string; code: string; word_id: string }>(
    restricted
      ? `SELECT DISTINCT t.kind AS kind, t.code AS code, s.word_id AS word_id
           FROM sense_tags t JOIN senses s ON s.id = t.sense_id
          WHERE s.word_id IN (${poolIds.map(() => "?").join(",")})`
      : `SELECT DISTINCT t.kind AS kind, t.code AS code, s.word_id AS word_id
           FROM sense_tags t JOIN senses s ON s.id = t.sense_id`,
    ...poolIds
  );
  for (const r of rows) {
    // Only when the IN-list was skipped: the restricted query already filtered.
    if (!restricted && pool !== null && !pool.has(r.word_id)) continue;
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

  /*
   * Result types, resolved against what is already applied.
   *
   * This is what makes nonsense combinations disappear on their own rather than needing a rule
   * per pair. Two kinds of conflict:
   *   - two result types at once (`#kanji #name`) — a result is one thing or the other.
   *   - a non-word type plus a WORD filter (`#kanji #verb-godan`) — godan is a property of words,
   *     and no kanji has it.
   * Both report 0, and the autocomplete already drops anything that would narrow to zero.
   */
  const appliedTypes = applied.filter((c) => c.kind === "result");
  const appliedWordFilters = applied.some((c) => c.kind !== "result");
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (c.kind !== "result") continue;
    const clashesWithType = appliedTypes.some((t) => t.id !== c.id);
    const clashesWithFilter = c.result !== "word" && appliedWordFilters;
    counts[c.id] =
      clashesWithType || clashesWithFilter ? 0 : await browseCount(store, c);
  }

  // The same conflict in the OTHER direction: with a non-word type applied, every WORD filter is
  // meaningless — `#kanji #verb-godan` asks for a kanji that is a godan verb, and none is. Zeroing
  // here is what actually removes them from the suggestions; the loop above only handled the case
  // where the word filter came first.
  if (appliedTypes.some((t) => t.result !== "word")) {
    for (const c of CLASSIFIER_BY_ID.values()) {
      if (c.kind !== "result") counts[c.id] = 0;
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
  if (classifier.kind === "result") {
    if (classifier.result === "kanji") {
      const row = await store.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM kanji_characters"
      );
      return row?.n ?? 0;
    }
    if (classifier.result === "word") {
      const row = await store.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM words"
      );
      return row?.n ?? 0;
    }
    // Names and places live in the separate names dictionary, which this store is not. The counts
    // response reports availability instead, and the field hides them when it is absent.
    return 0;
  }
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
