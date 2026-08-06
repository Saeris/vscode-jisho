import type {
  KanjiResultDto,
  RadicalDto,
  RadicalLookupDto
} from "../../shared/messages";
import type { SqliteStore } from "../store";
import { parseStrings } from "./parse";

/** Cached radical grid + radical→kanji sets for the (repeatedly-called) radical picker. */
interface RadicalCache {
  list: RadicalDto[];
  kanji: Map<string, Set<string>>;
}

export interface RadicalLookup {
  lookupRadicals: (selected: string[]) => Promise<RadicalLookupDto>;
}

/**
 * The radical picker's queries, over a store.
 *
 * A factory rather than a plain function because the radical→kanji sets are cached for the lifetime
 * of the dictionary: the picker re-queries on every toggle, and Radkfile is only 253 radicals, so
 * loading once and intersecting in memory beats per-toggle SQL. The cache is the only reason this
 * module holds state, and scoping it to the factory keeps it out of `Dictionary`.
 */
export const radicalLookup = (store: SqliteStore): RadicalLookup => {
  let cache: RadicalCache | undefined;

  // Radkfile radical → its kanji set, loaded once (253 radicals; small). The picker calls
  // lookupRadicals repeatedly as the user toggles selections, so caching avoids re-reading.

  const load = async (): Promise<RadicalCache> => {
    if (cache) return cache;
    const rows = await store.all<{
      radical: string;
      stroke_count: number;
      kanji_json: string;
      position: string | null;
    }>(
      "SELECT radical, stroke_count, kanji_json, position FROM radicals ORDER BY stroke_count, radical"
    );
    const list = rows.map((r) => ({
      radical: r.radical,
      strokeCount: r.stroke_count,
      position: r.position
    }));
    const kanji = new Map<string, Set<string>>();
    for (const r of rows) {
      kanji.set(r.radical, new Set(parseStrings(r.kanji_json)));
    }
    cache = { list, kanji };
    return cache;
  };

  /**
   * Radical picker: given the selected radicals, return every radical (for the grid), which
   * radicals could still be added without emptying the match set (for greying out), and the
   * kanji containing *all* selected radicals (frequency-ranked). Selection intersection and
   * reachability run in memory over the cached radical→kanji sets — no per-toggle SQL.
   */
  const lookupRadicals = async (
    selected: string[]
  ): Promise<RadicalLookupDto> => {
    const { list, kanji } = await load();

    // Intersect the kanji sets of the selected radicals.
    const selectedSets = selected
      .map((r) => kanji.get(r))
      .filter((s): s is Set<string> => s !== undefined);
    const matchSet: Set<string> | null =
      selectedSets.length > 0
        ? selectedSets.reduce((acc, s) => acc.intersection(s))
        : null;

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
      const rows = await store.all<{
        literal: string;
        stroke_count: number | null;
        grade: number | null;
        jlpt: number | null;
        frequency: number | null;
        on_json: string;
        kun_json: string;
        meanings_json: string;
      }>(
        // OR chain, not IN — Turso does not index-optimize IN (see the deinflection query).
        `SELECT literal, stroke_count, grade, jlpt, frequency, on_json, kun_json, meanings_json
           FROM kanji_characters
          WHERE (${literals.map(() => "literal = ?").join(" OR ")})
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

    return { radicals: list, enabled, matches };
  };

  return { lookupRadicals };
};
