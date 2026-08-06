import { isKana, toKana } from "wanakana";
import type {
  KanjiResultDto,
  PartOfSpeech,
  SearchResultDto
} from "../../shared/messages";
import type { SqliteStore } from "../store";
import {
  candidateMatchesPos,
  deinflectCandidates,
  type Candidate,
  type Condition
} from "../deinflect";
import { anyPosMatches } from "../../shared/pos";
import { toHiragana } from "../../shared/ruby";
import { hasKanji, isKanjiChar } from "../../shared/japanese";
import { byFrequency, parseCodes, parseStrings, stripHonorific } from "./parse";

/**
 * Search, ranking, and lemma resolution — the query path every keystroke takes.
 *
 * `searchResult` is exported because the kanji page's "words containing this character" section
 * renders the same row shape; keeping one hydrator means the two lists cannot drift.
 */

/**
 * Search by Japanese (kanji/kana), Hepburn romaji, or English (gloss) input. Results are ordered
 * by a composite relevance score (best-scoring term per word) so obvious answers surface first —
 * see the CASE tiers in the SQL. Latin queries are lowercased and matched against `term_lower`;
 * Japanese queries match `term` directly.
 *
 * `extraLemmas` are dictionary-form candidates supplied by the caller's morphological tokenizer
 * (M5). They join the same deinflection-merge channel as the built-in rule-based `deinflect()`
 * fallback — the tokenizer is more accurate (no over-generation), but `Dictionary` stays
 * tokenizer-agnostic: when none are passed (tokenizer not ready, or non-Japanese input) the rule
 * table still covers conjugated queries.
 */
export const search = async (
  store: SqliteStore,
  rawQuery: string,
  limit = 50,
  extraLemmas: string[] = []
): Promise<SearchResultDto[]> => {
  const query = rawQuery.trim();
  if (query === "") return [];

  // Latin (English/romaji) queries match case-insensitively against `term_lower`; any query
  // containing non-ASCII (kana/kanji) matches `term` directly. Testing for a non-ASCII char
  // avoids a control-character regex range.
  const isLatin = !/[^ -~]/.test(query);
  // Table-qualified: the ranking query joins `words`, and both tables have an `is_common`, so
  // unqualified names are ambiguous.
  const column = isLatin ? "st.term_lower" : "st.term";
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
  //   - breadth penalty (capped): a gloss sharing its sense with many near-synonyms is a weaker
  //     signal. 食べる's first sense is just "to eat"; 喫する's is "to eat, to drink, to smoke,
  //     to take" — both list "to eat" first, so is_primary can't separate them and frequency
  //     actively misleads (喫する is the more common *newspaper* word). IDF, within a sense.
  //
  // FREQUENCY is a TIEBREAKER, not part of the score. Folding it in would let a very frequent
  // prefix match outrank an exact one (水曜日 above 水 when searching 水); the tiers encode
  // "closeness of match", which must dominate. Within a tier, though, ties were being broken
  // arbitrarily — every exact match scored identically, so "eat" led with 食らう (a vulgar
  // "devour") over 食べる. `words.freq_rank` (JMdict's own nfXX buckets) breaks them by real
  // usage. Its corpus is newspapers, so it has that skew — 端 still beats 箸 (BACKLOG #26).
  // Single-character latin queries stay exact-only: an "e%" range spans a huge slice of the
  // index and a 1-letter English prefix search is meaningless anyway.
  const exactOnly = isLatin && needle.length < 2;
  const where = exactOnly
    ? `${column} = ?1`
    : `${column} >= ?1 AND ${column} < ?2`;
  const rows = await store.all<{
    word_id: string;
    score: number;
    common: number;
    freq_rank: number | null;
  }>(
    `SELECT st.word_id AS word_id,
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
              + CASE WHEN st.is_primary = 1 THEN 10 ELSE 0 END
              + CASE WHEN st.is_common = 1 THEN 5 ELSE 0 END
              - MIN(LENGTH(${column}) - LENGTH(?1), 15)
              - MIN(st.sense_breadth - 1, 6)
            ) AS score,
            MAX(st.is_common) AS common,
            w.freq_rank AS freq_rank
       FROM search_terms st
       JOIN words w ON w.id = st.word_id
      WHERE ${where}
      GROUP BY st.word_id
      ORDER BY score DESC, freq_rank IS NULL, freq_rank, common DESC
      LIMIT ?3`,
    ...(exactOnly ? [needle, needle, limit] : [needle, `${needle}￿`, limit])
  );

  // Deinflection pass: expand a conjugated query (はなします) into candidate dictionary forms
  // (はなす) and merge their *exact headword* matches. Romaji input is transliterated to kana
  // first ("hanashimasu" → はなします) — only when the transliteration is fully kana, so
  // English queries ("study") are never mangled. Candidates score below a literal exact match
  // (130) but above prefix/substring noise, so typing a real word exactly still wins.
  // Deinflection candidates, each tagged with the POS conditions the conjugation implies. A term
  // reached as several classes (れば → any verb) keeps the union. Extra lemmas from the tokenizer
  // carry no conditions (they're already the right word), so they bypass POS validation.
  const byTerm = new Map<string, Condition[]>();
  const addCandidate = (c: Candidate): void => {
    const existing = byTerm.get(c.term);
    if (existing) existing.push(...c.conditions);
    else byTerm.set(c.term, [...c.conditions]);
  };
  for (const lemma of extraLemmas)
    if (!byTerm.has(lemma)) byTerm.set(lemma, []);
  if (isLatin) {
    const kana: string = toKana(needle);
    if (isKana(kana)) {
      if (!byTerm.has(kana)) byTerm.set(kana, []);
      for (const c of deinflectCandidates(kana)) addCandidate(c);
    }
  } else {
    for (const c of deinflectCandidates(needle)) addCandidate(c);
  }
  byTerm.delete(needle);

  interface Ranked {
    score: number;
    common: number;
    /** JMdict nfXX bucket; lower is more frequent, null = outside wordfreq's top ~24k. */
    freqRank: number | null;
  }
  const merged = new Map<string, Ranked>();
  for (const row of rows) {
    merged.set(row.word_id, {
      score: row.score,
      common: row.common,
      freqRank: row.freq_rank
    });
  }
  if (byTerm.size > 0) {
    const list = [...byTerm.keys()];
    // Fetch matched entries WITH the term that matched and the entry's POS codes, so a deinflection
    // is only accepted when the entry's part of speech is compatible with the conjugation that
    // produced it — rejecting して → 汁 (a noun) or きます → any non-verb, while keeping して → する.
    //
    // `term = ? OR term = ?` rather than `term IN (…)`: Turso does not use the index for IN, and
    // measured 0.3788ms against 0.0200ms for the equivalent OR chain on this table — a 19x
    // full-scan penalty on the common subset, which grows with the table. Same index-friendliness
    // rule as the LIKE ban in CONVENTIONS.md.
    const deinflected = await store.all<{
      word_id: string;
      term: string;
      common: number;
      freq_rank: number | null;
      pos_codes: string | null;
    }>(
      `SELECT st.word_id AS word_id, st.term AS term, MAX(st.is_common) AS common,
              w.freq_rank AS freq_rank,
              (SELECT group_concat(t.code, ' ') FROM sense_tags t
                JOIN senses se ON se.id = t.sense_id
               WHERE se.word_id = w.id AND t.kind = 'pos') AS pos_codes
         FROM search_terms st
         JOIN words w ON w.id = st.word_id
        WHERE kind IN ('kanji', 'kana')
          AND (${list.map(() => "term = ?").join(" OR ")})
        GROUP BY st.word_id, st.term
        LIMIT ?`,
      ...list,
      limit * 4
    );
    for (const row of deinflected) {
      const conditions = byTerm.get(row.term) ?? [];
      // A tokenizer lemma (no conditions) is already the intended word — accept it. A deinflection
      // candidate must have a POS-compatible entry, or it's a spurious homophone (しる's 汁).
      if (conditions.length > 0) {
        const codes = parseCodes(row.pos_codes);
        if (!candidateMatchesPos({ term: row.term, conditions }, codes)) {
          continue;
        }
      }
      const score = 90 + (row.common === 1 ? 5 : 0);
      const existing = merged.get(row.word_id);
      if (!existing || existing.score < score) {
        merged.set(row.word_id, {
          score,
          common: row.common,
          freqRank: row.freq_rank
        });
      }
    }
  }

  // Mirrors the SQL's ORDER BY exactly — the deinflection merge above can reorder things, so the
  // two must agree or results would shuffle depending on whether a query hit that path.
  const ranked = [...merged.entries()]
    .sort(
      (a, b) =>
        b[1].score - a[1].score ||
        byFrequency(a[1].freqRank, b[1].freqRank) ||
        b[1].common - a[1].common
    )
    .slice(0, limit);

  // One hydration query for the whole page, in ranked order — see `searchResults`.
  return searchResults(
    store,
    ranked.map(([wordId, { common }]) => ({ id: wordId, common: common === 1 }))
  );
};

const resolveExact = async (
  store: SqliteStore,
  lemma: string,
  pos: PartOfSpeech,
  reading?: string
): Promise<SearchResultDto | null> => {
  if (lemma === "") return null;
  const lemmaHasKanji = hasKanji(lemma);
  // Tokenizer readings are katakana (ホン); DB kana is hiragana (ほん). Empty when the tokenizer
  // had none (unknown word) — then there's nothing to disambiguate on and this tier stays off.
  const hira = reading !== undefined ? toHiragana(reading) : "";

  // Candidate entries whose kana reading OR kanji writing equals the lemma, with the signals the
  // ranking needs: whether the lemma matched a kanji writing, the POS codes + `uk` misc across
  // senses, whether any common kanji writing exists, frequency and commonness.
  const rows = await store.all<{
    word_id: string;
    kanji_match: number;
    reading_match: number;
    pos_codes: string | null;
    uk: number | null;
    sense_count: number;
    // NULL for a kana-only word (no kanji rows to MAX over).
    has_common_kanji: number | null;
    freq_rank: number | null;
    common: number;
  }>(
    // Candidates come from `search_terms`, NOT from joining `kanji`/`kana` on their text. Neither
    // of those tables indexes `text` (they key on word_id, position), so `WHERE k.text = ? OR
    // ka.text = ?` across two LEFT JOINs scanned the whole join product — a flat 61ms per call on
    // the common subset, on the hover's path. `search_terms` already indexes the same writings and
    // readings (idx_search_term), giving identical rows in ~0.03ms.
    `SELECT w.id AS word_id,
            (SELECT MAX(CASE WHEN text = ?1 THEN 1 ELSE 0 END)
               FROM kanji WHERE word_id = w.id) AS kanji_match,
            (SELECT MAX(CASE WHEN text = ?2 THEN 1 ELSE 0 END)
               FROM kana WHERE word_id = w.id) AS reading_match,
            (SELECT group_concat(t.code, ' ') FROM sense_tags t
                JOIN senses se ON se.id = t.sense_id
               WHERE se.word_id = w.id AND t.kind = 'pos') AS pos_codes,
            w.is_uk AS uk,
            (SELECT COUNT(*) FROM senses WHERE word_id = w.id) AS sense_count,
            (SELECT MAX(is_common) FROM kanji WHERE word_id = w.id) AS has_common_kanji,
            w.freq_rank AS freq_rank,
            w.is_common AS common
       FROM words w
       JOIN (SELECT DISTINCT word_id FROM search_terms
              WHERE term = ?1 AND (kind = 'kanji' OR kind = 'kana')) m
         ON m.word_id = w.id`,
    lemma,
    // "" never equals a real kana reading, so an absent tokenizer reading leaves this tier off.
    hira
  );
  if (rows.length === 0) return null;

  const scored = rows.map((r) => {
    const codes = parseCodes(r.pos_codes);
    const posOk = anyPosMatches(pos, codes);
    // Kana lemma normally written in kana: `uk`, or the entry has no common kanji form.
    const kanaPrimary =
      !lemmaHasKanji && (r.uk === 1 || (r.has_common_kanji ?? 0) === 0);
    return {
      id: r.word_id,
      common: r.common === 1,
      // Sort key, higher = better. Weighted so each tier dominates the next.
      rank:
        // Reading match dominates: 本 read ほん is 本/ほん, not the homograph 元/もと (freq-ranked).
        (r.reading_match === 1 ? 2000 : 0) +
        (lemmaHasKanji && r.kanji_match === 1 ? 1000 : 0) +
        (posOk ? 400 : 0) +
        (kanaPrimary ? 200 : 0) +
        (r.common === 1 ? 20 : 0) +
        // Sense breadth as a "workhorse word" tiebreaker, ABOVE frequency: when two entries share a
        // reading and everything above is level (成る "become", 11 senses, vs 生る "bear fruit", 1),
        // freq_rank picks the wrong one — it scores the KANJI CHARACTER's newspaper frequency (生 is
        // ubiquitous), not the word's. A many-sensed entry is the everyday word. Capped so it breaks
        // ties without ever outweighing an identity tier.
        Math.min(r.sense_count, 12) * 8 +
        // Frequency: lower freq_rank is better; fold in a small bounded bonus. NULL = no bonus.
        (r.freq_rank !== null ? Math.max(0, 60 - r.freq_rank) : 0)
    };
  });
  // rows was non-empty, so scored is too; sort in place and take the winner.
  scored.sort((a, b) => b.rank - a.rank);
  const [best] = scored;
  return searchResult(store, best.id, best.common);
};

/**
 * Resolve a tokenizer's (lemma, POS) to the single best-matching entry — the hover's word lookup.
 *
 * `search()` ranks a lemma STRING by frequency and re-introduces homophone ambiguity: searching
 * する returns 擦る ("to rub", freq-ranked) over 為る (する = "to do", usually written kana so its
 * kanji form was never frequency-ranked); searching し (surface) returns the noun 死. The tokenizer
 * already KNOWS the word is a verb with lemma する — so resolve using that, POS and all, exactly as
 * the example linkifier does. Ranking (best first):
 *   1. the tokenizer's READING matches an entry's kana (本 read ほん is 本/ほん, NOT 元/もと — which
 *      shares the kanji 本 but reads もと). A homograph shares the writing yet reads differently, so
 *      when the tokenizer knows the reading it is the strongest identity — above frequency, which is
 *      a writing-level signal (元 is a common word) that says nothing about which reading was meant,
 *   2. a KANJI-writing match when the lemma has kanji (the writing identifies the word),
 *   3. POS-compatible senses (verb entry for a verb lemma — rejects the noun 死 for する's stem),
 *   4. for a KANA lemma, entries normally written in kana (`uk`, or no common kanji form) — this is
 *      what floats 為る above 擦る, since freq_rank is backwards for usually-kana words,
 *   5. sense breadth (a many-sensed entry is the everyday word — 成る "become" over 生る "bear
 *      fruit"), ABOVE frequency because freq_rank scores the kanji character, not the word,
 *   6. then frequency, then common.
 * Returns null when nothing matches the lemma at all (the caller falls back to `search`).
 */
export const resolveByLemma = async (
  store: SqliteStore,
  lemma: string,
  pos: PartOfSpeech,
  reading?: string
): Promise<SearchResultDto | null> => {
  const direct = await resolveExact(store, lemma, pos, reading);
  if (direct !== null) return direct;
  // Honorific fallback: IPADIC glues お/ご into a noun's base (お送り, ご連絡, お問い合わせ), which has
  // no entry, so the direct resolution above returns null. Retry once with the prefix stripped —
  // 送り→送る. This is null-ONLY, so it can't regress a working case, and it's inherently safe
  // against LEXICALIZED honorifics (お茶/ご飯/お願い): those ARE entries, so they resolved directly
  // and never reach here. The reading, if any, loses its お/ご too (オオクリ → クリ... actually the
  // tokenizer's reading is for the prefixed surface, so drop it and let the stripped lemma resolve
  // on writing + POS alone).
  const stripped = stripHonorific(lemma);
  if (stripped !== null) {
    return resolveExact(store, stripped, pos, undefined);
  }
  return null;
};

/**
 * Kanji matching a query, for the search list's separate "Kanji" section. CJK input matches
 * each distinct character exactly (kanji_literal); latin input matches meaning words
 * (kanji_meaning) exactly, then by prefix. Index-friendly throughout (exact + range scan).
 */
export const searchKanji = async (
  store: SqliteStore,
  rawQuery: string,
  limit = 8
): Promise<KanjiResultDto[]> => {
  const query = rawQuery.trim();
  if (query === "") return [];

  const isLatin = !/[^ -~]/.test(query);
  let literals: string[];
  if (isLatin) {
    const needle = query.toLowerCase();
    // 1-char latin queries stay exact-only: an "e%" range spans a huge slice of the index and
    // a 1-letter meaning prefix is meaningless (same guard as `search`).
    const where = needle.length < 2 ? "term = ?1" : "term >= ?1 AND term < ?2";
    const rows = await store.all<{ kanji: string; exact: number }>(
      `SELECT kanji, MAX(CASE WHEN term = ?1 THEN 1 ELSE 0 END) AS exact
         FROM search_terms
        WHERE kind = 'kanji_meaning' AND ${where}
        GROUP BY kanji
        ORDER BY exact DESC, MAX(is_common) DESC
        LIMIT ?3`,
      ...(needle.length < 2
        ? [needle, needle, limit]
        : [needle, `${needle}￿`, limit])
    );
    literals = rows.map((r) => r.kanji);
  } else {
    // Each distinct CJK character of the query, in order. Candidates are passed through unchecked:
    // `kanjiResults` already drops any literal `kanji_characters` does not have, so a separate
    // existence query per character only asks the same question twice.
    // Array.from iterates by code point, so multi-unit characters stay intact.
    const seen = new Set<string>();
    literals = Array.from(query)
      .filter((c) => isKanjiChar(c) && !seen.has(c) && seen.add(c))
      .slice(0, limit);
    if (literals.length === 0) return [];
  }

  return kanjiResults(store, literals);
};

/**
 * Hydrate kanji literals into result rows.
 *
 * Exported because the browse path (`#kanji`, #27) renders the same row shape from a different
 * selection — sharing the hydrator is what keeps a searched kanji and a browsed one identical,
 * exactly as `searchResult` does for words.
 */
export const kanjiResults = async (
  store: SqliteStore,
  literals: string[]
): Promise<KanjiResultDto[]> => {
  if (literals.length === 0) return [];
  // One query for the whole set, not one per literal: `#kanji` browse passes 2,000 of them, and
  // under the synchronous driver that is 2,000 blocking round trips. Same reasoning as
  // `searchResults`.
  const rows = await store.all<{
    literal: string;
    stroke_count: number | null;
    grade: number | null;
    jlpt: number | null;
    on_json: string;
    kun_json: string;
    meanings_json: string;
  }>(
    `SELECT literal, stroke_count, grade, jlpt, on_json, kun_json, meanings_json
       FROM kanji_characters WHERE literal IN (${literals.map(() => "?").join(",")})`,
    ...literals
  );
  // Re-ordered to match the caller's ordering (frequency, or search rank), which SQL does not keep.
  const byLiteral = new Map(rows.map((r) => [r.literal, r]));
  const out: KanjiResultDto[] = [];
  for (const literal of literals) {
    const row = byLiteral.get(literal);
    if (!row) continue;
    out.push({
      literal: row.literal,
      strokeCount: row.stroke_count,
      grade: row.grade,
      jlpt: row.jlpt,
      meaningPreview: parseStrings(row.meanings_json).slice(0, 3).join(", "),
      onPreview: parseStrings(row.on_json).join("、"),
      kunPreview: parseStrings(row.kun_json).join("、")
    });
  }
  return out;
};

/** The columns a result row is assembled from, however they were fetched. */
interface ResultParts {
  readonly id: string;
  readonly common: boolean;
  readonly kanji: string | null;
  readonly kanjiCommon: number | null;
  readonly kana: string | null;
  readonly gloss: string | null;
  readonly jlpt: number | null;
  readonly uk: number | null;
}

/**
 * Assemble one result row. Shared by the single-id and batched paths so the heading rules below
 * cannot drift between "a word you searched" and "a word in a browsed list" — they render through
 * the same component, so a divergence here would be visible and arbitrary.
 */
const toResult = (p: ResultParts): SearchResultDto | null => {
  const reading = p.kana ?? "";
  // Show the kana as the heading when the word is `uk` (usually-kana) AND its kanji writing is NOT
  // common — 此処/一寸/有難う/為る are archaic-kanji, so ここ/ちょっと/ありがとう/する read cleaner. But
  // `uk` alone is too blunt: 美味しい/犬/来る/置く are `uk` yet routinely written in (common) kanji, so
  // gating on an uncommon kanji writing keeps their kanji heading. Non-uk words always lead kanji.
  const kanaCanonical =
    p.uk === 1 && (p.kanjiCommon ?? 0) === 0 && reading !== "";
  const headword = kanaCanonical ? reading : (p.kanji ?? reading);
  if (headword === "") return null;
  return {
    id: p.id,
    headword,
    // A separate reading line only when the heading is kanji; kana headings already read themselves.
    reading: headword === reading ? "" : reading,
    common: p.common,
    glossPreview: p.gloss ?? "",
    jlpt: p.jlpt ?? null
  };
};

/** The four correlated lookups a result row needs, as columns on `words`. */
const RESULT_COLUMNS = `w.id AS id, w.jlpt AS jlpt, w.is_uk AS uk,
    (SELECT text FROM kanji WHERE word_id = w.id ORDER BY position LIMIT 1) AS kanji,
    (SELECT is_common FROM kanji WHERE word_id = w.id ORDER BY position LIMIT 1) AS kanji_common,
    (SELECT text FROM kana WHERE word_id = w.id ORDER BY position LIMIT 1) AS kana,
    (SELECT g.text FROM senses s JOIN glosses g ON g.sense_id = s.id
      WHERE s.word_id = w.id ORDER BY s.position, g.position LIMIT 1) AS gloss`;

interface ResultRow {
  id: string;
  jlpt: number | null;
  uk: number | null;
  kanji: string | null;
  kanji_common: number | null;
  kana: string | null;
  gloss: string | null;
}

/**
 * Hydrate a whole page of results in ONE query.
 *
 * The per-id version below costs four queries per row, so a 2,000-row browse ran 8,000 of them —
 * measured at 609ms against 43ms for this, a 14x difference on the same rows. That was always
 * wasteful, but it became VISIBLE when the engine moved to the synchronous `node:sqlite`: the work
 * no longer interleaves with the event loop, so it lands as one blocking burst and the webview
 * cannot paint until it ends.
 *
 * Returns rows in the order the ids were given — the caller has already ranked or ordered them, and
 * SQL would otherwise hand them back in whatever order the index walk produced.
 */
export const searchResults = async (
  store: SqliteStore,
  ids: Array<{ id: string; common: boolean }>
): Promise<SearchResultDto[]> => {
  if (ids.length === 0) return [];
  const rows = await store.all<ResultRow>(
    `SELECT ${RESULT_COLUMNS} FROM words w WHERE w.id IN (${ids.map(() => "?").join(",")})`,
    ...ids.map((r) => r.id)
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: SearchResultDto[] = [];
  for (const { id, common } of ids) {
    const r = byId.get(id);
    if (r === undefined) continue;
    const result = toResult({
      id,
      common,
      kanji: r.kanji,
      kanjiCommon: r.kanji_common,
      kana: r.kana,
      gloss: r.gloss,
      jlpt: r.jlpt,
      uk: r.uk
    });
    if (result !== null) out.push(result);
  }
  return out;
};

export const searchResult = async (
  store: SqliteStore,
  id: string,
  common: boolean
): Promise<SearchResultDto | null> => {
  const row = await store.get<ResultRow>(
    `SELECT ${RESULT_COLUMNS} FROM words w WHERE w.id = ?`,
    id
  );
  if (row === undefined) return null;
  return toResult({
    id,
    common,
    kanji: row.kanji,
    kanjiCommon: row.kanji_common,
    kana: row.kana,
    gloss: row.gloss,
    jlpt: row.jlpt,
    uk: row.uk
  });
};
