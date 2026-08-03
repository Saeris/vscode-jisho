/**
 * Host-side dictionary query layer. Opens the Turso/SQLite database and exposes typed,
 * async lookups that return the plain DTOs from `../shared/messages`. The UI never touches
 * SQL — it goes through the message protocol, which calls these.
 */
import { SqliteStore } from "./store";
import { radicalLookup, type RadicalLookup } from "./queries/radicals";
import { getComponentTree, getKanji } from "./queries/kanji";
import { getMoreExamples, getWord } from "./queries/words";
import { resolveByLemma, search, searchKanji } from "./queries/search";
import {
  browse,
  browseCount,
  refineCounts,
  type BrowseOrder
} from "./queries/browse";
import type { Classifier } from "../shared/classifiers";
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from "../shared/schema";
import type {
  ComponentTreeDto,
  KanjiDetailDto,
  KanjiResultDto,
  MoreExamplesDto,
  PartOfSpeech,
  RadicalLookupDto,
  SearchResultDto,
  WordDetailDto
} from "../shared/messages";

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

/** Wraps an open database with prepared, hydrated queries. */
export class Dictionary {
  #store: SqliteStore;
  #radicals: RadicalLookup;

  private constructor(store: SqliteStore) {
    this.#store = store;
    this.#radicals = radicalLookup(store);
  }

  static async open(path: string): Promise<Dictionary> {
    const store = await SqliteStore.open(path);
    const dict = new Dictionary(store);
    await dict.#assertSchemaVersion();
    await store.loadTags("tags");
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
    const row = await this.#store.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      SCHEMA_VERSION_KEY
    );
    const found = row === undefined ? 0 : Number(row.value);
    if (found !== SCHEMA_VERSION) {
      throw new SchemaVersionError(SCHEMA_VERSION, found);
    }
  }

  async close(): Promise<void> {
    await this.#store.close();
  }

  /** Radical picker. Delegated to a factory because it owns a cache; see queries/radicals.ts. */
  async lookupRadicals(selected: string[]): Promise<RadicalLookupDto> {
    return this.#radicals.lookupRadicals(selected);
  }

  // Thin delegates so the ~50 call sites below read unchanged; the caching and typing live in
  /**
   * Everything below delegates to `./queries/*`, one module per vertical.
   *
   * This class was 1,123 lines with search, word detail, kanji and radicals interleaved. They share
   * only the store, so each vertical is now a module of plain functions over `SqliteStore` and this
   * is the seam the rest of the host talks to. `names.ts` already used `SqliteStore` standalone;
   * this brings the main dictionary to the same shape.
   */

  /** Provenance/attribution key-values written by the data build (source, license, dictDate…). */
  async getMeta(): Promise<Record<string, string>> {
    const rows = await this.#store.all<{ key: string; value: string }>(
      "SELECT key, value FROM meta"
    );
    const meta: Record<string, string> = {};
    for (const { key, value } of rows) meta[key] = value;
    return meta;
  }

  async search(
    rawQuery: string,
    limit = 50,
    extraLemmas: string[] = []
  ): Promise<SearchResultDto[]> {
    return search(this.#store, rawQuery, limit, extraLemmas);
  }

  async resolveByLemma(
    lemma: string,
    pos: PartOfSpeech,
    reading?: string
  ): Promise<SearchResultDto | null> {
    return resolveByLemma(this.#store, lemma, pos, reading);
  }

  async searchKanji(rawQuery: string, limit = 8): Promise<KanjiResultDto[]> {
    return searchKanji(this.#store, rawQuery, limit);
  }

  /**
   * Browse a classifier's words (#54). A separate path from `search` — see queries/browse.ts for
   * why filtering and ranking are not the same query.
   */
  async browse(
    classifier: Classifier,
    order: BrowseOrder = "frequency",
    limit = 2000
  ): Promise<SearchResultDto[]> {
    return browse(this.#store, classifier, order, limit);
  }

  /** How many words a classifier holds — the browse tree's counts. */
  async browseCount(classifier: Classifier): Promise<number> {
    return browseCount(this.#store, classifier);
  }

  /**
   * For every classifier, how many words would remain if it were added to `applied` (#27). Drives
   * the tag autocomplete's counts, and lets it hide combinations that would narrow to zero.
   */
  async refineCounts(applied: Classifier[]): Promise<Record<string, number>> {
    return refineCounts(this.#store, applied);
  }

  async getWord(id: string): Promise<WordDetailDto | null> {
    return getWord(this.#store, id);
  }

  async getMoreExamples(id: string): Promise<MoreExamplesDto | null> {
    return getMoreExamples(this.#store, id);
  }

  async getKanji(literal: string): Promise<KanjiDetailDto | null> {
    return getKanji(this.#store, literal);
  }

  async getComponentTree(literal: string): Promise<ComponentTreeDto | null> {
    return getComponentTree(this.#store, literal);
  }
}
