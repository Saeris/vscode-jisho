/**
 * Host-side dictionary query layer. Opens the Turso/SQLite database and exposes typed,
 * async lookups that return the plain DTOs from `../shared/messages`. The UI never touches
 * SQL — it goes through the message protocol, which calls these.
 */
import { connect } from "@tursodatabase/database";
import { isKana, toKana } from "wanakana";
import {
  candidateMatchesPos,
  deinflectCandidates,
  type Candidate,
  type Condition
} from "./deinflect";
import {
  SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  WORD_LEVEL_SENSE
} from "../shared/schema";
import { anyPosMatches } from "../shared/pos";
import { toHiragana } from "../shared/ruby";
import type {
  ComponentTreeDto,
  ExampleGroupDto,
  KanaDto,
  KanjiDetailDto,
  KanjiDto,
  KanjiResultDto,
  KanjiWordDto,
  MoreExamplesDto,
  PartOfSpeech,
  PoolSentenceDto,
  RadicalLookupDto,
  SearchResultDto,
  SenseDto,
  SentenceDto,
  TagDto,
  WordDetailDto
} from "../shared/messages";

type Db = Awaited<ReturnType<typeof connect>>;

/**
 * Thrown when a database's schema version doesn't match this build's expectation. Typed so the
 * delivery layer can distinguish "wrong shape, re-provision" from a genuine open/IO failure and
 * prompt the user to update rather than showing a raw SQL error.
 */
export class SchemaVersionError extends Error {
  constructor(
    readonly expected: number,
    readonly found: number
  ) {
    super(
      `Dictionary schema version ${found} does not match the required ${expected}. The database needs to be updated.`
    );
    this.name = "SchemaVersionError";
  }
}

/** Cached radical grid + radical→kanji sets for the (repeatedly-called) radical picker. */
interface RadicalCache {
  list: Array<{ radical: string; strokeCount: number }>;
  kanji: Map<string, Set<string>>;
}

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
    await dict.#assertSchemaVersion();
    await dict.#loadTags();
    return dict;
  }

  /**
   * Refuse to run against a database whose schema does not match what this build queries.
   *
   * A version-skewed DB (an old one cached from before a schema change, or an artifact that fell
   * out of sync with the shipped `.vsix`) would otherwise fail deep inside a query on a missing
   * column — an opaque runtime crash. Failing fast here, with a typed error the caller can turn
   * into an "update your dictionary" prompt, is the correctness core of the delivery pipeline.
   *
   * A DB with no `schemaVersion` (built before this existed) is treated as version 0, i.e. a
   * mismatch — those must be re-provisioned.
   */
  async #assertSchemaVersion(): Promise<void> {
    const row = await this.#get<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      SCHEMA_VERSION_KEY
    );
    const found = row === undefined ? 0 : Number(row.value);
    if (found !== SCHEMA_VERSION) {
      throw new SchemaVersionError(SCHEMA_VERSION, found);
    }
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
   *
   * `extraLemmas` are dictionary-form candidates supplied by the caller's morphological tokenizer
   * (M5). They join the same deinflection-merge channel as the built-in rule-based `deinflect()`
   * fallback — the tokenizer is more accurate (no over-generation), but `Dictionary` stays
   * tokenizer-agnostic: when none are passed (tokenizer not ready, or non-Japanese input) the rule
   * table still covers conjugated queries.
   */
  async search(
    rawQuery: string,
    limit = 50,
    extraLemmas: string[] = []
  ): Promise<SearchResultDto[]> {
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
    const rows = await this.#all<{
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
      const deinflected = await this.#all<{
        word_id: string;
        term: string;
        common: number;
        freq_rank: number | null;
        pos_codes: string | null;
      }>(
        `SELECT st.word_id AS word_id, st.term AS term, MAX(st.is_common) AS common,
                w.freq_rank AS freq_rank,
                (SELECT group_concat(pos_json, ' ') FROM senses WHERE word_id = w.id) AS pos_codes
           FROM search_terms st
           JOIN words w ON w.id = st.word_id
          WHERE kind IN ('kanji', 'kana')
            AND term IN (${list.map(() => "?").join(", ")})
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

    const results: SearchResultDto[] = [];
    for (const [wordId, { common }] of ranked) {
      const preview = await this.#searchResult(wordId, common === 1);
      if (preview) results.push(preview);
    }
    return results;
  }

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
   *   5. then frequency, then common.
   * Returns null when nothing matches the lemma at all (the caller falls back to `search`).
   */
  async resolveByLemma(
    lemma: string,
    pos: PartOfSpeech,
    reading?: string
  ): Promise<SearchResultDto | null> {
    if (lemma === "") return null;
    const hasKanji = /[㐀-鿿豈-﫿]/u.test(lemma);
    // Tokenizer readings are katakana (ホン); DB kana is hiragana (ほん). Empty when the tokenizer
    // had none (unknown word) — then there's nothing to disambiguate on and this tier stays off.
    const hira = reading !== undefined ? toHiragana(reading) : "";

    // Candidate entries whose kana reading OR kanji writing equals the lemma, with the signals the
    // ranking needs: whether the lemma matched a kanji writing, the POS codes + `uk` misc across
    // senses, whether any common kanji writing exists, frequency and commonness.
    const rows = await this.#all<{
      word_id: string;
      kanji_match: number;
      reading_match: number;
      pos_codes: string | null;
      uk: number | null;
      // NULL for a kana-only word (no kanji rows to MAX over).
      has_common_kanji: number | null;
      freq_rank: number | null;
      common: number;
    }>(
      `SELECT w.id AS word_id,
              MAX(CASE WHEN k.text = ?1 THEN 1 ELSE 0 END) AS kanji_match,
              (SELECT MAX(CASE WHEN text = ?2 THEN 1 ELSE 0 END)
                 FROM kana WHERE word_id = w.id) AS reading_match,
              (SELECT group_concat(pos_json, ' ') FROM senses WHERE word_id = w.id) AS pos_codes,
              (SELECT MAX(CASE WHEN misc_json LIKE '%"uk"%' THEN 1 ELSE 0 END)
                 FROM senses WHERE word_id = w.id) AS uk,
              (SELECT MAX(is_common) FROM kanji WHERE word_id = w.id) AS has_common_kanji,
              w.freq_rank AS freq_rank,
              w.is_common AS common
         FROM words w
         LEFT JOIN kanji k ON k.word_id = w.id
         LEFT JOIN kana ka ON ka.word_id = w.id
        WHERE k.text = ?1 OR ka.text = ?1
        GROUP BY w.id`,
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
        !hasKanji && (r.uk === 1 || (r.has_common_kanji ?? 0) === 0);
      return {
        id: r.word_id,
        common: r.common === 1,
        // Sort key, higher = better. Weighted so each tier dominates the next.
        rank:
          // Reading match dominates: 本 read ほん is 本/ほん, not the homograph 元/もと (freq-ranked).
          (r.reading_match === 1 ? 2000 : 0) +
          (hasKanji && r.kanji_match === 1 ? 1000 : 0) +
          (posOk ? 400 : 0) +
          (kanaPrimary ? 200 : 0) +
          (r.common === 1 ? 20 : 0) +
          // Frequency: lower freq_rank is better; fold in a small bounded bonus. NULL = no bonus.
          (r.freq_rank !== null ? Math.max(0, 60 - r.freq_rank) : 0)
      };
    });
    // rows was non-empty, so scored is too; sort in place and take the winner.
    scored.sort((a, b) => b.rank - a.rank);
    const [best] = scored;
    return this.#searchResult(best.id, best.common);
  }

  /**
   * Kanji matching a query, for the search list's separate "Kanji" section. CJK input matches
   * each distinct character exactly (kanji_literal); latin input matches meaning words
   * (kanji_meaning) exactly, then by prefix. Index-friendly throughout (exact + range scan).
   */
  async searchKanji(rawQuery: string, limit = 8): Promise<KanjiResultDto[]> {
    const query = rawQuery.trim();
    if (query === "") return [];

    const isLatin = !/[^ -~]/.test(query);
    let literals: string[];
    if (isLatin) {
      const needle = query.toLowerCase();
      // 1-char latin queries stay exact-only: an "e%" range spans a huge slice of the index and
      // a 1-letter meaning prefix is meaningless (same guard as `search`).
      const where =
        needle.length < 2 ? "term = ?1" : "term >= ?1 AND term < ?2";
      const rows = await this.#all<{ kanji: string; exact: number }>(
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
      // Each distinct CJK character of the query, in order, that is a known kanji. Look up the
      // character directly against `kanji_characters` (PK on `literal`) — the search_terms index
      // is on `term`, not `kanji`, so an IN-over-kanji query would full-scan.
      // Array.from iterates by code point, so multi-unit characters stay intact.
      const seen = new Set<string>();
      const chars = Array.from(query)
        .filter((c) => /[㐀-鿿豈-﫿]/.test(c) && !seen.has(c) && seen.add(c))
        .slice(0, limit);
      if (chars.length === 0) return [];
      literals = [];
      for (const c of chars) {
        const hit = await this.#get<{ literal: string }>(
          "SELECT literal FROM kanji_characters WHERE literal = ?",
          c
        );
        if (hit) literals.push(hit.literal);
      }
    }

    const out: KanjiResultDto[] = [];
    for (const literal of literals) {
      const row = await this.#get<{
        literal: string;
        stroke_count: number | null;
        grade: number | null;
        jlpt: number | null;
        on_json: string;
        kun_json: string;
        meanings_json: string;
      }>(
        `SELECT literal, stroke_count, grade, jlpt, on_json, kun_json, meanings_json
           FROM kanji_characters WHERE literal = ?`,
        literal
      );
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
  }

  async #searchResult(
    id: string,
    common: boolean
  ): Promise<SearchResultDto | null> {
    const kanji = await this.#get<{ text: string; is_common: number }>(
      "SELECT text, is_common FROM kanji WHERE word_id = ? ORDER BY position LIMIT 1",
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
    const word = await this.#get<{ jlpt: number | null; uk: number | null }>(
      `SELECT w.jlpt AS jlpt,
              (SELECT MAX(CASE WHEN misc_json LIKE '%"uk"%' THEN 1 ELSE 0 END)
                 FROM senses WHERE word_id = w.id) AS uk
         FROM words w WHERE w.id = ?`,
      id
    );

    const reading = kana?.text ?? "";
    // Show the kana as the heading when the word is `uk` (usually-kana) AND its kanji writing is NOT
    // common — 此処/一寸/有難う/為る are archaic-kanji, so ここ/ちょっと/ありがとう/する read cleaner. But
    // `uk` alone is too blunt: 美味しい/犬/来る/置く are `uk` yet routinely written in (common) kanji, so
    // gating on an uncommon kanji writing keeps their kanji heading. Non-uk words always lead kanji.
    const kanaCanonical =
      word?.uk === 1 && (kanji?.is_common ?? 0) === 0 && reading !== "";
    const headword = kanaCanonical ? reading : (kanji?.text ?? reading);
    if (headword === "") return null;
    return {
      id,
      headword,
      // A separate reading line only when the heading is kanji; kana headings already read themselves.
      reading: headword === reading ? "" : reading,
      common,
      glossPreview: gloss?.text ?? "",
      jlpt: word?.jlpt ?? null
    };
  }

  /**
   * The recursive component tree for a kanji (cjk-decomp), or `null` when it has no meaningful
   * decomposition (the caller then falls back to the flat component list). Each node carries a short
   * meaning/reading annotation; children come from `component_tree` edges, walked depth-first.
   *
   * A `seen` set breaks cycles (a component can transitively contain itself in the raw data) and
   * caps runaway depth defensively. The trees are shallow (mostly ≤3), so per-node lookups are fine.
   */
  async getComponentTree(literal: string): Promise<ComponentTreeDto | null> {
    const build = async (
      node: string,
      seen: Set<string>
    ): Promise<ComponentTreeDto> => {
      const meta = await this.#get<{
        meanings_json: string;
        on_json: string;
        kun_json: string;
      }>(
        "SELECT meanings_json, on_json, kun_json FROM kanji_characters WHERE literal = ?",
        node
      );
      const edges = seen.has(node)
        ? []
        : await this.#all<{ child: string }>(
            "SELECT child FROM component_tree WHERE literal = ? ORDER BY position",
            node
          );
      const nextSeen = new Set(seen).add(node);
      const children: ComponentTreeDto[] = [];
      for (const { child } of edges) {
        children.push(await build(child, nextSeen));
      }
      return {
        literal: node,
        meaningPreview: meta
          ? parseStrings(meta.meanings_json).slice(0, 3).join(", ")
          : "",
        readingPreview: meta
          ? [...parseStrings(meta.on_json), ...parseStrings(meta.kun_json)]
              .slice(0, 4)
              .join("、")
          : "",
        children
      };
    };

    const root = await build(literal, new Set());
    // No tree to show — the caller renders the flat parts list instead.
    return root.children.length === 0 ? null : root;
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
    const word = await this.#get<{
      id: string;
      is_common: number;
      jlpt: number | null;
    }>("SELECT id, is_common, jlpt FROM words WHERE id = ?", id);
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
    // Pitch accents are keyed by (word_id, reading); load them once and attach per reading.
    const pitchRows = await this.#all<{
      reading: string;
      accents_json: string;
    }>("SELECT reading, accents_json FROM pitch_accents WHERE word_id = ?", id);
    const pitchByReading = new Map<string, number[]>();
    for (const p of pitchRows) {
      pitchByReading.set(p.reading, parseNumbers(p.accents_json));
    }
    const kana: KanaDto[] = kanaRows.map((r) => ({
      text: r.text,
      common: r.is_common === 1,
      tags: parseStrings(r.tags_json),
      appliesToKanji: parseStrings(r.applies_to_kanji_json),
      pitchAccents: pitchByReading.get(r.text) ?? []
    }));

    const senseRows = await this.#all<{
      id: number;
      position: number;
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
      `SELECT id, position, pos_json, field_json, misc_json, info_json, dialect_json,
              applies_to_kanji_json, applies_to_kana_json, related_json, antonym_json
         FROM senses WHERE word_id = ? ORDER BY position`,
      id
    );

    // Inline example sentences: the curated per-sense Tanaka set (source='tanaka'), keyed by
    // sense_position. The fuller Tatoeba pool (source='tatoeba') is deliberately excluded here — it
    // feeds the separate "more examples" surface (F1), not the inline per-sense list. Loaded once and
    // grouped by sense.
    const sentenceRows = await this.#all<{
      sense_position: number;
      ja: string;
      en: string;
    }>(
      "SELECT sense_position, ja, en FROM sentences WHERE word_id = ? AND source = 'tanaka' ORDER BY sense_position, position",
      id
    );
    const sentencesBySense = new Map<number, SentenceDto[]>();
    for (const r of sentenceRows) {
      const list = sentencesBySense.get(r.sense_position) ?? [];
      list.push({ ja: r.ja, en: r.en });
      sentencesBySense.set(r.sense_position, list);
    }

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
        antonym: flattenXrefs(s.antonym_json),
        sentences: sentencesBySense.get(s.position) ?? []
      });
    }

    return {
      id: word.id,
      common: word.is_common === 1,
      jlpt: word.jlpt,
      kanji,
      kana,
      senses
    };
  }

  /**
   * The fuller Tatoeba example pool for a word (F1 "more examples" page), or `null` if the word has
   * no pooled examples. Sentences the source tagged to a sense are grouped under that sense's gloss;
   * the rest (sense_position = -1) are the word-level pool. `ja_furigana` carries build-time ruby.
   */
  async getMoreExamples(id: string): Promise<MoreExamplesDto | null> {
    const rows = await this.#all<{
      sense_position: number;
      position: number;
      ja_furigana: string;
      en: string;
    }>(
      `SELECT sense_position, position, ja_furigana, en
         FROM sentences
        WHERE word_id = ? AND source = 'tatoeba'
        ORDER BY sense_position, position`,
      id
    );
    if (rows.length === 0) return null;

    // The page title: the word's first kanji writing, or first kana reading if kana-only.
    const headwordRow =
      (await this.#get<{ text: string }>(
        "SELECT text FROM kanji WHERE word_id = ? ORDER BY position LIMIT 1",
        id
      )) ??
      (await this.#get<{ text: string }>(
        "SELECT text FROM kana WHERE word_id = ? ORDER BY position LIMIT 1",
        id
      ));

    const wordLevel: PoolSentenceDto[] = [];
    const bySense = new Map<number, PoolSentenceDto[]>();
    for (const r of rows) {
      const sentence: PoolSentenceDto = { jaFurigana: r.ja_furigana, en: r.en };
      if (r.sense_position === WORD_LEVEL_SENSE) {
        wordLevel.push(sentence);
      } else {
        const list = bySense.get(r.sense_position) ?? [];
        list.push(sentence);
        bySense.set(r.sense_position, list);
      }
    }

    // Header each sense group with its first gloss. Read them for just the senses that have pooled
    // sentences, keyed by sense position.
    const senses: ExampleGroupDto[] = [];
    for (const [position, sentences] of [...bySense.entries()].sort(
      (a, b) => a[0] - b[0]
    )) {
      const gloss = await this.#get<{ text: string }>(
        `SELECT g.text AS text
           FROM senses s JOIN glosses g ON g.sense_id = s.id
          WHERE s.word_id = ? AND s.position = ?
          ORDER BY g.position LIMIT 1`,
        id,
        position
      );
      senses.push({ gloss: gloss?.text ?? "", sentences });
    }

    return {
      headword: headwordRow?.text ?? "",
      senses,
      wordLevel
    };
  }

  /** Full detail for one kanji character, or `null` if it isn't in Kanjidic. */
  async getKanji(literal: string): Promise<KanjiDetailDto | null> {
    const row = await this.#get<{
      literal: string;
      grade: number | null;
      stroke_count: number | null;
      frequency: number | null;
      jlpt: number | null;
      on_json: string;
      kun_json: string;
      meanings_json: string;
      nanori_json: string;
    }>(
      `SELECT literal, grade, stroke_count, frequency, jlpt,
              on_json, kun_json, meanings_json, nanori_json
         FROM kanji_characters WHERE literal = ?`,
      literal
    );
    if (!row) return null;

    // A component only has a detail page if Kanjidic knows it. Kradfile is a *visual* decomposition
    // (not the 214 Kangxi radicals) and substitutes JIS-encodable lookalikes for elements it can't
    // encode — ノ ハ マ ユ ヨ ｜ — which are real components but not kanji. The LEFT JOIN settles
    // that here, where the data is, instead of leaving the UI to offer a page that 404s.
    // Does a recursive tree exist? One cheap existence check — gates the detail's tree link so we
    // never offer a page that would be empty (the getComponentTree fallback returns null there).
    const treeEdge = await this.#get<{ one: number }>(
      "SELECT 1 AS one FROM component_tree WHERE literal = ? LIMIT 1",
      literal
    );

    const componentRows = await this.#all<{
      component: string;
      has_detail: number;
    }>(
      `SELECT c.component AS component,
              CASE WHEN k.literal IS NULL THEN 0 ELSE 1 END AS has_detail
         FROM kanji_components c
         LEFT JOIN kanji_characters k ON k.literal = c.component
        WHERE c.literal = ?
        ORDER BY c.component`,
      literal
    );

    // Visually-similar kanji (F3), precomputed and ranked. Every `similar` value FK-references a
    // kanji_characters row, so each has a detail page — no has_detail gate needed. Join its meanings
    // so a tile can show a short gloss (which distinguishes look-alikes from parts at a glance).
    const similarRows = await this.#all<{ similar: string; meanings: string }>(
      `SELECT s.similar AS similar, k.meanings_json AS meanings
         FROM similar_kanji s
         JOIN kanji_characters k ON k.literal = s.similar
        WHERE s.literal = ?
        ORDER BY s.position`,
      literal
    );

    // Common words containing this kanji, via the precomputed `char` term rows (already indexed).
    // Common-first, then by genuine frequency (F2): `common DESC` alone leaves ties unbroken, so a
    // rare common-tagged word could sit above 食べる. `words.freq_rank` (JMdict nfXX buckets, lower =
    // more frequent, NULL = outside the top ~24k) breaks the tie — `freq_rank IS NULL` sinks the
    // unranked below the ranked (SQLite sorts NULL first by default, backwards here), then ASC floats
    // the most frequent. Same frequency signal search ranking already uses.
    const wordRows = await this.#all<{ word_id: string; common: number }>(
      `SELECT s.word_id AS word_id, MAX(s.is_common) AS common
         FROM search_terms s
         JOIN words w ON w.id = s.word_id
        WHERE s.kind = 'char' AND s.term = ?
        GROUP BY s.word_id
        ORDER BY common DESC, w.freq_rank IS NULL, w.freq_rank ASC
        LIMIT 10`,
      literal
    );
    const words: KanjiWordDto[] = [];
    for (const { word_id, common } of wordRows) {
      const preview = await this.#searchResult(word_id, common === 1);
      if (preview) {
        words.push({
          id: preview.id,
          headword: preview.headword,
          reading: preview.reading,
          glossPreview: preview.glossPreview
        });
      }
    }

    return {
      literal: row.literal,
      grade: row.grade,
      strokeCount: row.stroke_count,
      frequency: row.frequency,
      jlpt: row.jlpt,
      on: parseStrings(row.on_json),
      kun: parseStrings(row.kun_json),
      meanings: parseStrings(row.meanings_json),
      nanori: parseStrings(row.nanori_json),
      components: componentRows.map((c) => ({
        literal: c.component,
        hasDetail: c.has_detail === 1
      })),
      similar: similarRows.map((r) => ({
        literal: r.similar,
        // First meaning only — a compact label for the tile, not the full gloss list.
        meaning: parseStrings(r.meanings)[0] ?? ""
      })),
      hasTree: treeEdge !== undefined,
      words
    };
  }

  // Radkfile radical → its kanji set, loaded once (253 radicals; small). The picker calls
  // lookupRadicals repeatedly as the user toggles selections, so caching avoids re-reading.
  #radicals: RadicalCache | undefined;

  async #loadRadicals(): Promise<RadicalCache> {
    if (this.#radicals) return this.#radicals;
    const rows = await this.#all<{
      radical: string;
      stroke_count: number;
      kanji_json: string;
    }>(
      "SELECT radical, stroke_count, kanji_json FROM radicals ORDER BY stroke_count, radical"
    );
    const list = rows.map((r) => ({
      radical: r.radical,
      strokeCount: r.stroke_count
    }));
    const kanji = new Map<string, Set<string>>();
    for (const r of rows) {
      kanji.set(r.radical, new Set(parseStrings(r.kanji_json)));
    }
    this.#radicals = { list, kanji };
    return this.#radicals;
  }

  /**
   * Radical picker: given the selected radicals, return every radical (for the grid), which
   * radicals could still be added without emptying the match set (for greying out), and the
   * kanji containing *all* selected radicals (frequency-ranked). Selection intersection and
   * reachability run in memory over the cached radical→kanji sets — no per-toggle SQL.
   */
  async lookupRadicals(selected: string[]): Promise<RadicalLookupDto> {
    const { list, kanji } = await this.#loadRadicals();

    // Intersect the kanji sets of the selected radicals.
    const selectedSets = selected
      .map((r) => kanji.get(r))
      .filter((s): s is Set<string> => s !== undefined);
    let matchSet: Set<string> | null = null;
    if (selectedSets.length > 0) {
      matchSet = new Set(selectedSets[0]);
      for (const s of selectedSets.slice(1)) {
        matchSet = new Set([...matchSet].filter((k) => s.has(k)));
      }
    }

    // A radical stays enabled if adding it to the current match set keeps something. With nothing
    // selected, all radicals are enabled (empty list signals that to the UI).
    const enabled: string[] =
      matchSet === null
        ? []
        : list
            .map((r) => r.radical)
            .filter((r) => {
              if (selected.includes(r)) return true;
              const set = kanji.get(r);
              if (!set) return false;
              for (const k of matchSet) if (set.has(k)) return true;
              return false;
            });

    // Hydrate the matching kanji into result DTOs, frequency-ranked (nulls last), capped.
    const matches: KanjiResultDto[] = [];
    if (matchSet !== null) {
      const literals = [...matchSet];
      const rows = await this.#all<{
        literal: string;
        stroke_count: number | null;
        grade: number | null;
        jlpt: number | null;
        frequency: number | null;
        on_json: string;
        kun_json: string;
        meanings_json: string;
      }>(
        `SELECT literal, stroke_count, grade, jlpt, frequency, on_json, kun_json, meanings_json
           FROM kanji_characters
          WHERE literal IN (${literals.map(() => "?").join(", ")})
          ORDER BY frequency IS NULL, frequency
          LIMIT 100`,
        ...literals
      );
      for (const row of rows) {
        matches.push({
          literal: row.literal,
          strokeCount: row.stroke_count,
          grade: row.grade,
          jlpt: row.jlpt,
          meaningPreview: parseStrings(row.meanings_json)
            .slice(0, 3)
            .join(", "),
          onPreview: parseStrings(row.on_json).join("、"),
          kunPreview: parseStrings(row.kun_json).join("、")
        });
      }
    }

    return {
      radicals: list.map((r) => ({
        radical: r.radical,
        strokeCount: r.strokeCount
      })),
      enabled,
      matches
    };
  }
}

/**
 * Order two JMdict nfXX frequency buckets: lower rank = more frequent = first, and unranked words
 * (null — anything outside wordfreq's top ~24,000) sort last rather than first, which is what a
 * naive numeric compare on null would do.
 */
const byFrequency = (a: number | null, b: number | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

/** Parse a JSON-encoded string array from a DB column, tolerating malformed data. */
const parseStrings = (json: string): string[] => {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
};

/**
 * Parse the space-joined `group_concat` of several `pos_json` arrays (one per sense) into a flat set
 * of JMdict POS codes — e.g. `["v5r","vt"] ["n"]` → v5r, vt, n. Tolerates the malformed by scanning
 * for quoted tokens rather than JSON.parse-ing the concatenation (which isn't valid JSON as a whole).
 */
const parseCodes = (concatenated: string | null): string[] => {
  if (concatenated === null) return [];
  const codes = new Set<string>();
  for (const m of concatenated.matchAll(/"([^"]+)"/gu)) codes.add(m[1]);
  return [...codes];
};

/** Parse a JSON-encoded number array from a DB column, tolerating malformed data. */
const parseNumbers = (json: string): number[] => {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((v) => typeof v === "number") : [];
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
