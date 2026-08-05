import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const known = new Set(
      (
        raw.prepare("SELECT tag FROM tags").all() as {
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
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const stmt = raw.prepare(
      "SELECT sort_key FROM kana WHERE word_id = ? ORDER BY position LIMIT 1"
    );
    const keys: string[] = [];
    for (const r of rows) {
      const row = stmt.get(r.id) as { sort_key: string } | undefined;
      if (row) keys.push(row.sort_key);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
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

  test("the precomputed counts agree with counting the rows directly", async () => {
    // WHY: `refineCounts([])` is served from `classifier_counts`, which the BUILD writes — so the
    // number the browse tree shows is only as good as that table. A cache that silently disagrees
    // with the data it summarises is the specific failure this introduces, and every other test
    // here would still pass through it: they assert magnitudes ("> 1000"), which a wrong-but-large
    // number satisfies. So count a few categories straight from `sense_tags`/`words` and demand
    // exact equality.
    const counts = await dict.refineCounts([]);
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const scalar = async (
      sql: string,
      ...params: string[]
    ): Promise<number> => {
      const row = raw.prepare(sql).get(...params) as { n: number } | undefined;
      return row?.n ?? 0;
    };

    // An exact-code tag, a prefix family (godan is v5r/v5k/v5s… with no umbrella code), a
    // `words`-column classifier, and a whole-table one — one of each shape the build counts.
    const distinctForCode = `SELECT COUNT(DISTINCT s.word_id) AS n
                               FROM sense_tags t JOIN senses s ON s.id = t.sense_id
                              WHERE t.kind = 'pos' AND t.code = ?`;
    expect(counts["noun"]).toBe(await scalar(distinctForCode, "n"));
    expect(counts["verb-godan"]).toBe(
      await scalar(
        `SELECT COUNT(DISTINCT s.word_id) AS n
           FROM sense_tags t JOIN senses s ON s.id = t.sense_id
          WHERE t.kind = 'pos' AND t.code >= 'v5' AND t.code < 'v5￿'`
      )
    );
    expect(counts["jlpt-n5"]).toBe(
      await scalar("SELECT COUNT(*) AS n FROM words WHERE jlpt = 5")
    );
    expect(counts["word"]).toBe(
      await scalar("SELECT COUNT(*) AS n FROM words")
    );
    expect(counts["kanji"]).toBe(
      await scalar("SELECT COUNT(*) AS n FROM kanji_characters")
    );
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

  test("#kanji returns kanji rows, ordered for browsing", async () => {
    // WHY (#27): a result-type tag has to actually RETURN its type. Until this existed the tag
    // suggested, filtered and counted correctly while opening an empty list — promising more than
    // it delivered.
    const kanji = CLASSIFIER_BY_ID.get("kanji")!;
    const rows = await dict.browseKanji(kanji, 20);
    expect(rows).toHaveLength(20);
    for (const r of rows) expect(r.literal).not.toBe("");
    // Ordered by newspaper frequency, so the characters a reader meets first lead. 日 and 一 are
    // among the very most frequent kanji in Japanese, so one of them heads any frequency-ordered
    // list — asserting on the SET rather than an exact position keeps this stable if the corpus
    // shifts by a rank or two.
    expect(
      rows
        .slice(0, 5)
        .map((r) => r.literal)
        .join("")
    ).toMatch(/[日一人大年]/u);
  });

  test("a word classifier returns no kanji, and vice versa", async () => {
    // WHY: the response carries both arrays and the view branches on which is populated, so a
    // classifier filling BOTH would render a list of the wrong kind — or of two kinds at once.
    const n5 = CLASSIFIER_BY_ID.get("jlpt-n5")!;
    await expect(dict.browseKanji(n5, 20)).resolves.toEqual([]);
    const kanji = CLASSIFIER_BY_ID.get("kanji")!;
    await expect(dict.browse(kanji, "frequency", 20)).resolves.toEqual([]);
  });

  test("a sparse category answers truthfully rather than failing", async () => {
    // WHY: Ryuukyuu-ben has a valid JMdict code (`rkb`) but almost no words — ZERO in a `common`
    // build, since dialect words are mostly not common; a handful in a full one. Either is a
    // truthful answer about the shipped data, and both must render as a list rather than an error.
    //
    // Asserted as "rows and count agree" rather than a fixed number, because the answer legitimately
    // depends on which variant was built — pinning it to 0 made this fail the moment a full DB was
    // present, which is a property of the fixture, not a defect.
    const rkb = CLASSIFIER_BY_ID.get("ryuukyuu")!;
    const rows = await dict.browse(rkb);
    const count = await dict.browseCount(rkb);
    expect(Array.isArray(rows)).toBe(true);
    expect(count).toBe(rows.length);
  });
});
