import type * as vscode from "vscode";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecent,
  MAX_RECENT,
  readRecent,
  recordRecent
} from "../recentSearches";

/**
 * `recentSearches` imports `vscode` for types only, so it needs no module mock — just something
 * shaped like the Memento it writes to.
 */
const memento = new Map<string, unknown>();
const context = {
  globalState: {
    get: (key: string) => memento.get(key),
    update: async (key: string, value: unknown) => {
      if (value === undefined) memento.delete(key);
      else memento.set(key, value);
    }
  }
} as unknown as vscode.ExtensionContext;

describe("recent searches", () => {
  beforeEach(() => memento.clear());

  it("returns the newest lookup first", async () => {
    // WHY: the empty view renders this list top-down, so "most recent" has to be "first" without
    // the UI needing to sort.
    await recordRecent(context, { query: "たべる", headword: "食べる" });
    await recordRecent(context, { query: "のむ", headword: "飲む" });
    expect(readRecent(context).map((r) => r.headword)).toEqual([
      "飲む",
      "食べる"
    ]);
  });

  it("deduplicates by headword, keeping the most recent query", async () => {
    // WHY: searching romaji then kana for the same word is ONE word looked up twice. Showing it
    // twice is noise, and the query worth keeping is the one they typed most recently — that is
    // the form they are likely to type again.
    await recordRecent(context, { query: "taberu", headword: "食べる" });
    await recordRecent(context, { query: "食べ", headword: "食べる" });
    const recent = readRecent(context);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.query).toBe("食べ");
  });

  it(`keeps at most ${MAX_RECENT} entries`, async () => {
    // WHY: unbounded history turns the empty view into its own list to search, and the Memento is
    // synced across machines — it should not grow without limit.
    for (let i = 0; i < MAX_RECENT + 5; i++) {
      await recordRecent(context, { query: `q${i}`, headword: `w${i}` });
    }
    const recent = readRecent(context);
    expect(recent).toHaveLength(MAX_RECENT);
    // The oldest five fell off, not the newest.
    expect(recent[0]?.headword).toBe(`w${MAX_RECENT + 4}`);
    expect(recent.some((r) => r.headword === "w0")).toBe(false);
  });

  it("ignores a lookup with no query to re-run", async () => {
    // WHY: tapping through from one entry to another opens a detail with no query text behind it.
    // There is nothing to re-run, so remembering it would give the user a dead row.
    await recordRecent(context, { query: "   ", headword: "食べる" });
    await recordRecent(context, { query: "たべる", headword: "  " });
    expect(readRecent(context)).toEqual([]);
  });

  it("survives a corrupt or legacy stored value", async () => {
    // WHY: this data outlives the shape that wrote it — a Memento persists across extension
    // upgrades. Throwing here would break the search view, so a bad value reads as no history.
    memento.set("recentSearches", "not an array");
    expect(readRecent(context)).toEqual([]);
    memento.set("recentSearches", [
      { query: "ok", headword: "OK", at: 1 },
      42,
      null
    ]);
    expect(readRecent(context).map((r) => r.headword)).toEqual(["OK"]);
  });

  it("clears everything", async () => {
    await recordRecent(context, { query: "たべる", headword: "食べる" });
    await clearRecent(context);
    expect(readRecent(context)).toEqual([]);
  });
});
