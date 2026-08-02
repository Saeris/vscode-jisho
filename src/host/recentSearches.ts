/**
 * Recent-search history (BACKLOG #17).
 *
 * Persisted in the extension's `globalState` Memento — the same mechanism the dictionary-update
 * throttle uses. Global rather than workspace-scoped: a dictionary lookup is about the language,
 * not about the project you happened to be in when you looked it up.
 *
 * What counts as a "search" is the load-bearing decision here. It is NOT every keystroke — the
 * query text updates as you type, so recording that would fill the list with `食`, `食べ`, `食べる`,
 * every prefix of every search. A search is recorded when the user ACTS on a result by opening a
 * detail view, which is a discrete, deliberate signal. That also makes the list more useful: it
 * becomes "words I looked up" rather than "things I typed".
 */
import type * as vscode from "vscode";

const KEY = "recentSearches";

/**
 * How many to keep. Enough that yesterday's study session is still there, small enough that the
 * empty view stays scannable rather than becoming its own list to search.
 */
export const MAX_RECENT = 20;

/** One remembered lookup: the query text, and what it resolved to so we can render it richly. */
export interface RecentSearch {
  /** The text to re-run when tapped. */
  query: string;
  /** What the user actually opened — shown as the label when it differs from the query. */
  headword: string;
  /** Epoch millis, for ordering and for a relative "2 days ago" if we ever want one. */
  at: number;
}

/** Most-recent-first. Never throws: a corrupt/legacy value reads as an empty history. */
export const readRecent = (
  context: vscode.ExtensionContext
): RecentSearch[] => {
  const stored = context.globalState.get<unknown>(KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecentSearch).slice(0, MAX_RECENT);
};

/**
 * Record a lookup, most-recent-first.
 *
 * Deduplicated by HEADWORD, not by query: searching `taberu`, then `食べる`, then tapping the same
 * entry both times is one word looked up twice, and showing it twice would be noise. The newest
 * entry wins, so the stored query is whatever the user typed most recently — which is the form
 * they are most likely to type again.
 */
export const recordRecent = async (
  context: vscode.ExtensionContext,
  entry: Omit<RecentSearch, "at">
): Promise<void> => {
  const query = entry.query.trim();
  const headword = entry.headword.trim();
  // A lookup reached by tapping through from another entry can arrive with no query text; there is
  // nothing to re-run, so there is nothing worth remembering.
  if (query === "" || headword === "") return;

  const next: RecentSearch[] = [
    { query, headword, at: Date.now() },
    ...readRecent(context).filter((r) => r.headword !== headword)
  ].slice(0, MAX_RECENT);
  await context.globalState.update(KEY, next);
};

/** Forget everything. Backs the "Clear recent searches" command. */
export const clearRecent = async (
  context: vscode.ExtensionContext
): Promise<void> => {
  await context.globalState.update(KEY, undefined);
};

/**
 * Structural check on a stored entry. Written out rather than trusting the generic on
 * `globalState.get` — that generic is an assertion, not a validation, and this data outlives the
 * shape that wrote it.
 */
const isRecentSearch = (value: unknown): value is RecentSearch =>
  typeof value === "object" &&
  value !== null &&
  "query" in value &&
  typeof value.query === "string" &&
  "headword" in value &&
  typeof value.headword === "string" &&
  "at" in value &&
  typeof value.at === "number";
