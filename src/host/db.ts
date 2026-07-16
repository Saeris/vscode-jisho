/**
 * Host-side dictionary query layer. Opens the Turso/SQLite database and exposes typed,
 * async lookups that return the plain DTOs from `../shared/messages`. The UI never touches
 * SQL — it goes through the message protocol, which calls these.
 */
import { connect } from "@tursodatabase/database";
import { isKana, toKana } from "wanakana";
import { deinflect } from "./deinflect";
import type {
  ComponentTreeDto,
  KanaDto,
  KanjiDetailDto,
  KanjiDto,
  KanjiResultDto,
  KanjiWordDto,
  RadicalLookupDto,
  SearchResultDto,
  SenseDto,
  SentenceDto,
  TagDto,
  WordDetailDto
} from "../shared/messages";

type Db = Awaited<ReturnType<typeof connect>>;

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
    const candidates = new Set<string>(extraLemmas);
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
    if (candidates.size > 0) {
      const list = [...candidates];
      const deinflected = await this.#all<{
        word_id: string;
        common: number;
        freq_rank: number | null;
      }>(
        `SELECT st.word_id AS word_id, MAX(st.is_common) AS common, w.freq_rank AS freq_rank
           FROM search_terms st
           JOIN words w ON w.id = st.word_id
          WHERE kind IN ('kanji', 'kana')
            AND term IN (${list.map(() => "?").join(", ")})
          GROUP BY st.word_id
          LIMIT ?`,
        ...list,
        limit
      );
      for (const row of deinflected) {
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
    const word = await this.#get<{ jlpt: number | null }>(
      "SELECT jlpt FROM words WHERE id = ?",
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

  /** Raw stroke-order SVG markup for a kanji, or `null` when we have no animation for it. */
  async getStrokeSvg(literal: string): Promise<string | null> {
    const row = await this.#get<{ svg: string }>(
      "SELECT svg FROM stroke_svgs WHERE literal = ?",
      literal
    );
    return row?.svg ?? null;
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

    // Example sentences are keyed by (word_id, sense_position); load them once and group.
    const sentenceRows = await this.#all<{
      sense_position: number;
      ja: string;
      en: string;
    }>(
      "SELECT sense_position, ja, en FROM sentences WHERE word_id = ? ORDER BY sense_position, position",
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

    // Common words containing this kanji, via the precomputed `char` term rows (already indexed).
    const wordRows = await this.#all<{ word_id: string; common: number }>(
      `SELECT word_id, MAX(is_common) AS common FROM search_terms
        WHERE kind = 'char' AND term = ?
        GROUP BY word_id
        ORDER BY common DESC
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
