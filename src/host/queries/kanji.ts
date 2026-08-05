import type {
  ComponentTreeDto,
  KanjiDetailDto,
  KanjiWordDto
} from "../../shared/messages";
import type { SqliteStore } from "../store";
import { parseStrings } from "./parse";
import { searchResults } from "./search";

/**
 * The kanji-character queries: one character's full page, and the recursive component tree behind it.
 *
 * `getKanji`'s "words containing this kanji" section reuses `searchResults` from the search module —
 * it is the same row shape the search list renders, so it stays single-sourced there.
 */

/**
 * The recursive component tree for a kanji (cjk-decomp), or `null` when it has no meaningful
 * decomposition (the caller then falls back to the flat component list). Each node carries a short
 * meaning/reading annotation; children come from `component_tree` edges, walked depth-first.
 *
 * A `seen` set breaks cycles (a component can transitively contain itself in the raw data) and
 * caps runaway depth defensively. The trees are shallow (mostly ≤3), so per-node lookups are fine.
 */
export const getComponentTree = async (
  store: SqliteStore,
  literal: string
): Promise<ComponentTreeDto | null> => {
  const build = async (
    node: string,
    seen: Set<string>
  ): Promise<ComponentTreeDto> => {
    const meta = await store.get<{
      meanings_json: string;
      on_json: string;
      kun_json: string;
    }>(
      "SELECT meanings_json, on_json, kun_json FROM kanji_characters WHERE literal = ?",
      node
    );
    const edges = seen.has(node)
      ? []
      : await store.all<{ child: string }>(
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
};

/** Full detail for one kanji character, or `null` if it isn't in Kanjidic. */
export const getKanji = async (
  store: SqliteStore,
  literal: string
): Promise<KanjiDetailDto | null> => {
  const row = await store.get<{
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
  const treeEdge = await store.get<{ one: number }>(
    "SELECT 1 AS one FROM component_tree WHERE literal = ? LIMIT 1",
    literal
  );

  const componentRows = await store.all<{
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
  const similarRows = await store.all<{ similar: string; meanings: string }>(
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
  const wordRows = await store.all<{ word_id: string; common: number }>(
    `SELECT s.word_id AS word_id, MAX(s.is_common) AS common
       FROM search_terms s
       JOIN words w ON w.id = s.word_id
      WHERE s.kind = 'char' AND s.term = ?
      GROUP BY s.word_id
      ORDER BY common DESC, w.freq_rank IS NULL, w.freq_rank ASC
      LIMIT 10`,
    literal
  );
  // One hydration query for the whole list — see `searchResults`.
  const previews = await searchResults(
    store,
    wordRows.map((r) => ({ id: r.word_id, common: r.common === 1 }))
  );
  const words: KanjiWordDto[] = previews.map((p) => ({
    id: p.id,
    headword: p.headword,
    reading: p.reading,
    glossPreview: p.glossPreview
  }));

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
};
