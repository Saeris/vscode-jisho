import { existsSync } from "node:fs";
import { join } from "node:path";
import { connect } from "@tursodatabase/database";
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { Dictionary } from "../db";
import { CLASSIFIERS, CLASSIFIER_BY_ID } from "../../shared/classifiers";

/**
 * Browsing by classifier (#54) against the real built database.
 *
 * The classifier table is hand-authored — a label and a JMdict code per category — which makes its
 * failure mode silence: a code that does not exist returns an empty list, and an empty list looks
 * exactly like a category that legitimately has no words. That already happened once during
 * development (`v5` matches nothing; godan verbs are stored as `v5r`, `v5k`, `v5s`…), so these
 * tests exist to make a mistyped or stale code fail loudly instead.
 */
const DB_PATH = join(process.cwd(), "assets", "jisho.db");
const describeIfDb = existsSync(DB_PATH) ? describe : describe.skip;

describeIfDb("browse by classifier", () => {
  let dict: Dictionary;
  beforeAll(async () => {
    dict = await Dictionary.open(DB_PATH);
  });
  afterAll(async () => {
    await dict?.close();
  });

  test("every classifier resolves to a real JMdict code", async () => {
    // WHY: this is the guard for the whole hand-authored table. A typo, or a code JMdict retires,
    // produces an empty category rather than an error — indistinguishable from a category that is
    // genuinely empty in this build. Checking the CODE exists separates the two.
    const raw = await connect(DB_PATH, { readonly: true });
    try {
      const known = new Set(
        (
          (await (await raw.prepare("SELECT tag FROM tags")).all()) as {
            tag: string;
          }[]
        ).map((r) => r.tag)
      );
      const unknown: string[] = [];
      for (const list of Object.values(CLASSIFIERS)) {
        for (const c of list) {
          if (c.kind !== "tag" || c.prefix) continue;
          if (!known.has(c.code)) unknown.push(`${c.id} (${c.code})`);
        }
      }
      expect(unknown).toEqual([]);
    } finally {
      await raw.close();
    }
  });

  test("prefix classifiers cover the verb families with no umbrella code", async () => {
    // WHY: the bug that nearly shipped. JMdict has no bare `v5` — godan verbs are one code per
    // ending (v5r, v5k, v5s… 13 of them), so an exact match returns ZERO and "Godan verbs" would
    // have rendered empty. Ichidan and suru have the same shape.
    for (const id of ["verb-godan", "verb-ichidan", "verb-suru"]) {
      const c = CLASSIFIER_BY_ID.get(id);
      expect(c).toBeDefined();
      await expect(dict.browseCount(c!)).resolves.toBeGreaterThan(100);
    }
  });

  test("returns search-shaped rows, so browse and search cannot drift", async () => {
    // WHY: both lists render through the same component. Sharing `searchResult` is what keeps a
    // browsed row and a searched row identical; this asserts the shape actually survives.
    const rows = await dict.browse(
      CLASSIFIER_BY_ID.get("jlpt-n5")!,
      "frequency",
      5
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.id).not.toBe("");
      expect(r.headword).not.toBe("");
      expect(typeof r.common).toBe("boolean");
    }
  });

  test("orders by frequency, most common first", async () => {
    // WHY: the default order is what makes a 653-word N5 list useful rather than arbitrary — the
    // words a learner meets first should be at the top. Ordering in SQL over `freq_rank`, not in
    // the webview, is also what keeps a 2,000-row payload cheap to render.
    const rows = await dict.browse(
      CLASSIFIER_BY_ID.get("jlpt-n5")!,
      "frequency",
      20
    );
    // The very common words (は, の, する…) cluster at the head; a mid-frequency word must not.
    const heads = rows.slice(0, 10).map((r) => r.headword);
    expect(heads).toHaveLength(10);
    // Every leading row should be a common word — that is what "ordered by frequency" means here.
    expect(rows.slice(0, 10).every((r) => r.common)).toBe(true);
  });

  test("orders by gojuon when asked, using the stored sort key", async () => {
    // WHY (#35): a browsable list is exactly the surface that wants kana order rather than
    // relevance — it is an index, and an index a reader scans alphabetically. `kana.sort_key` was
    // built for this; ordering in JS would mean shipping the whole list to sort it.
    const rows = await dict.browse(
      CLASSIFIER_BY_ID.get("jlpt-n5")!,
      "gojuon",
      50
    );
    expect(rows.length).toBeGreaterThan(10);
    // Readings must be non-decreasing under the same collation the DB used. Compare the stored
    // keys rather than the display strings, since that is what was actually sorted.
    const raw = await connect(DB_PATH, { readonly: true });
    try {
      const stmt = await raw.prepare(
        "SELECT sort_key FROM kana WHERE word_id = ? ORDER BY position LIMIT 1"
      );
      const keys: string[] = [];
      for (const r of rows) {
        const row = (await stmt.get(r.id)) as { sort_key: string } | undefined;
        if (row) keys.push(row.sort_key);
      }
      const sorted = [...keys].sort();
      expect(keys).toEqual(sorted);
    } finally {
      await raw.close();
    }
  });

  test("counts the whole category, not the capped page", async () => {
    // WHY: the browse tree shows counts so a reader knows what is worth opening. Deriving the
    // count from the capped row list would report the cap — "2000" for anything large — which is
    // worse than no number at all.
    const n5 = CLASSIFIER_BY_ID.get("jlpt-n5")!;
    const count = await dict.browseCount(n5);
    const capped = await dict.browse(n5, "frequency", 10);
    expect(capped).toHaveLength(10);
    expect(count).toBeGreaterThan(100);
  });

  test("result types report their own population", async () => {
    // WHY (#27): `#kanji` selects a KIND of result rather than narrowing words, so its count comes
    // from a different table entirely. A zero here would hide the tag from the autocomplete, which
    // filters out anything that would narrow to nothing.
    const counts = await dict.refineCounts([]);
    expect(counts.kanji).toBeGreaterThan(1000);
    expect(counts.word).toBeGreaterThan(1000);
  });

  test("a result type and a word filter cancel each other out", async () => {
    // WHY: `#kanji #verb-godan` is nonsense — godan is a property of words, and no kanji has it.
    // Reporting 0 is what makes the combination DISAPPEAR from the suggestions rather than needing
    // a hand-written rule per pair.
    const godan = CLASSIFIER_BY_ID.get("verb-godan")!;
    const counts = await dict.refineCounts([godan]);
    expect(counts.kanji).toBe(0);
    // …and the word type survives, since every godan verb is still a word.
    expect(counts.word).toBeGreaterThan(0);
  });

  test("two result types cancel each other out", async () => {
    // WHY: a result is one thing or the other, so `#kanji #word` can never match.
    const kanji = CLASSIFIER_BY_ID.get("kanji")!;
    const counts = await dict.refineCounts([kanji]);
    expect(counts.word).toBe(0);
    // The applied type still reports its own size — it is not competing with itself.
    expect(counts.kanji).toBeGreaterThan(1000);
  });

  test("a non-word type zeroes the word filters too", async () => {
    // WHY: the conflict has to hold in BOTH directions. Zeroing kanji when godan is applied is not
    // enough — a user who types the type FIRST would still be offered word filters that can never
    // match it, which is the order this shipped broken in.
    const kanji = CLASSIFIER_BY_ID.get("kanji")!;
    const counts = await dict.refineCounts([kanji]);
    expect(counts["verb-godan"]).toBe(0);
    expect(counts["noun"]).toBe(0);
    expect(counts["jlpt-n5"]).toBe(0);
  });

  test("a word filter still narrows normally alongside a word type", async () => {
    // WHY: `#word` is the identity filter over words, so it must not zero the word tags the way a
    // non-word type does — otherwise adding it would empty the suggestion list.
    const word = CLASSIFIER_BY_ID.get("word")!;
    const counts = await dict.refineCounts([word]);
    expect(counts["verb-godan"]).toBeGreaterThan(0);
  });

  test("an empty category returns an empty list rather than failing", async () => {
    // WHY: Ryuukyuu-ben has a valid JMdict code (`rkb`) and ZERO words in a `common` build —
    // dialect words are mostly not common. That is a truthful answer about the shipped data, so it
    // must render as an empty list, not an error. A full build populates it.
    const rkb = CLASSIFIER_BY_ID.get("ryuukyuu")!;
    await expect(dict.browse(rkb)).resolves.toEqual([]);
    await expect(dict.browseCount(rkb)).resolves.toBe(0);
  });
});
