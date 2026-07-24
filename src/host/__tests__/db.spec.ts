import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "@tursodatabase/database";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Dictionary, SchemaVersionError } from "../db";
import { SCHEMA_VERSION } from "../../shared/schema";

// These tests run against the real database produced by `vp run build:data`. If it hasn't been
// built yet, skip rather than fail — the build is an occasional, network-dependent step.
const DB_PATH = join(process.cwd(), "assets", "jisho.db");
const describeIfDb = existsSync(DB_PATH) ? describe : describe.skip;

describeIfDb("Dictionary (against built jisho.db)", () => {
  let dict: Dictionary;
  beforeAll(async () => {
    dict = await Dictionary.open(DB_PATH);
  });
  afterAll(async () => {
    await dict?.close();
  });

  test("ranks an exact Japanese match first", async () => {
    // WHY: users typing a full word expect it at the top, not buried under compounds that merely
    // contain it. This guards the exact > prefix > substring ranking in `search`.
    const results = await dict.search("食べる");
    expect(results[0]?.headword).toBe("食べる");
    expect(results[0]?.reading).toBe("たべる");
    expect(results[0]?.glossPreview).toBe("to eat");
  });

  test("puts the everyday word first when several share a gloss", async () => {
    // WHY: this shipped broken. Every exact match scored identically, so ordering fell to whatever
    // SQLite returned and "eat" led with 食らう — a vulgar "devour" — ahead of 食べる, the first
    // word any learner meets. Ranking must resolve those ties by real usage, not arbitrarily.
    const results = await dict.search("eat");
    expect(results[0]?.headword).toBe("食べる");
  });

  test("prefers the specific word over one that merely lists the gloss", async () => {
    // WHY: 喫する ("to eat, to drink, to smoke, to take") lists "to eat" as its FIRST gloss, exactly
    // like 食べる — so position can't separate them — and it's the more common *newspaper* word, so
    // frequency alone actively promotes it (it did, once). The discriminator is sense breadth: a
    // gloss sharing its sense with three near-synonyms is a weaker signal than one standing alone.
    const results = await dict.search("eat", 10);
    const taberu = results.findIndex((r) => r.headword === "食べる");
    const kissuru = results.findIndex((r) => r.headword === "喫する");
    expect(taberu).toBeGreaterThanOrEqual(0);
    if (kissuru >= 0) expect(taberu).toBeLessThan(kissuru);
  });

  test("ranks a frequent homophone above rarer ones", async () => {
    // WHY: こうえん maps to 公園/公演/講演/後援 — all common, all exact matches, previously a 4-way
    // tie that surfaced 講演 (lecture) over 公園 (park). JMdict's nfXX buckets break it by usage.
    const results = await dict.search("こうえん", 10);
    const park = results.findIndex((r) => r.headword === "公園");
    const lecture = results.findIndex((r) => r.headword === "講演");
    expect(park).toBeGreaterThanOrEqual(0);
    if (lecture >= 0) expect(park).toBeLessThan(lecture);
  });

  test("keeps an exact match ahead of a more frequent prefix match", async () => {
    // WHY: frequency is a TIEBREAKER, not a ranking axis. Folding it into the score would let a
    // very common compound outrank the exact word the user typed — 水 must never sit below 水曜日.
    // This is the guard that stops a future "just add frequency to the score" change.
    const results = await dict.search("水", 10);
    expect(results[0]?.headword).toBe("水");
  });

  test("finds words by kana reading", async () => {
    // WHY: kana input is the most common query for learners who can't type kanji; it must resolve.
    const results = await dict.search("たべる");
    expect(results.some((r) => r.headword === "食べる")).toBe(true);
  });

  test("finds words by English gloss", async () => {
    // WHY: the search surface must cover English→Japanese, not only Japanese input.
    const results = await dict.search("to eat");
    expect(results.some((r) => r.headword === "食べる")).toBe(true);
  });

  test("finds words by Hepburn romaji", async () => {
    // WHY: learners who can't type kana search by transliteration ("taberu"); the build derives
    // romaji terms from each reading, and this guards that path from silently regressing.
    const results = await dict.search("taberu");
    expect(results.some((r) => r.headword === "食べる")).toBe(true);
  });

  test("returns an empty list for a blank query", async () => {
    // WHY: an empty query must not scan the whole table or return noise while the user is typing.
    await expect(dict.search("   ")).resolves.toEqual([]);
  });

  // ── Relevance ranking (M2 #1) ─────────────────────────────────────────────
  // These guard the composite score: whole-word gloss tiers, primary-surface bonus, kind bonus,
  // and length penalty. Assertions use real entries; if a dictionary refresh shifts an exact
  // position, the intent is "the obvious answer is near the top", so top-N checks are used.

  test("ranks the plain word for an English gloss near the top", async () => {
    // WHY: "study" must surface 勉強 (whose first gloss IS "study"), not bury it under words
    // where "study" is a later or partial gloss. This was the headline M2 ranking bug.
    const results = await dict.search("study");
    const index = results.findIndex((r) => r.headword === "勉強");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(3);
  });

  test("ranks eat-verbs above compounds that merely mention eating", async () => {
    // WHY: whole-word gloss matching ("to eat" ends with the word "eat") must beat substring
    // noise like 飲食 ("food and drink" / "eating and drinking").
    const results = await dict.search("eat");
    const taberu = results.findIndex((r) => r.headword === "食べる");
    const inshoku = results.findIndex((r) => r.headword === "飲食");
    expect(taberu).toBeGreaterThanOrEqual(0);
    expect(taberu).toBeLessThan(5);
    if (inshoku !== -1) expect(taberu).toBeLessThan(inshoku);
  });

  // ── Deinflection (M2 #3) ──────────────────────────────────────────────────

  test("finds dictionary forms from conjugated input", async () => {
    // WHY: learners constantly search inflected forms; JMdict only stores dictionary forms, so
    // the deinflection pass must bridge them (はなします → 話す).
    const polite = await dict.search("はなします");
    expect(polite.some((r) => r.headword === "話す")).toBe(true);
    const past = await dict.search("食べた");
    expect(past.some((r) => r.headword === "食べる")).toBe(true);
    const adjective = await dict.search("たかくない");
    expect(adjective.some((r) => r.headword === "高い")).toBe(true);
  });

  test("deinflects romaji input via kana transliteration", async () => {
    // WHY: "hanashimasu" should behave like はなします — romaji users conjugate too.
    const results = await dict.search("hanashimasu");
    expect(results.some((r) => r.headword === "話す")).toBe(true);
  });

  test("tokenizer-provided lemmas surface their dictionary-form words", async () => {
    // WHY: M5 feeds the morphological tokenizer's lemma into search as a candidate. A query whose
    // rule-based deinflection might miss should still find the word when the tokenizer supplies the
    // base form — here 食べる passed as an extra lemma must surface 食べる.
    const results = await dict.search("たべ", 50, ["食べる"]);
    expect(results.some((r) => r.headword === "食べる")).toBe(true);
  });

  test("deinflection never displaces an exact match", async () => {
    // WHY: a literal exact match of the typed text must always beat generated candidates —
    // 食べる typed exactly stays first even though rules produce candidates from it.
    const results = await dict.search("食べる");
    expect(results[0]?.headword).toBe("食べる");
  });

  test("parenthetical gloss clarifications don't block exact matching", async () => {
    // WHY: 水's first gloss is "water (esp. cool or cold)" and 猫's is "cat (esp. the domestic
    // cat...)"; the build indexes a stripped variant so the bare word still matches exactly.
    const water = await dict.search("water");
    const mizu = water.findIndex((r) => r.headword === "水");
    expect(mizu).toBeGreaterThanOrEqual(0);
    expect(mizu).toBeLessThan(3);
    const cat = await dict.search("cat");
    expect(cat.findIndex((r) => r.headword === "猫")).toBe(0);
  });

  test("hydrates full detail with resolved POS tag descriptions", async () => {
    // WHY: the detail view groups senses by part-of-speech and shows human-readable tags; a broken
    // tag join would render cryptic codes ("v1") instead of "Ichidan verb".
    const [top] = await dict.search("食べる");
    const word = await dict.getWord(top.id);
    expect(word).not.toBeNull();
    expect(word!.common).toBe(true);
    expect(word!.kana[0]?.text).toBe("たべる");
    const codes = word!.senses[0]?.partOfSpeech.map((t) => t.code);
    expect(codes).toContain("v1");
    const v1 = word!.senses[0]?.partOfSpeech.find((t) => t.code === "v1");
    expect(v1?.description).toMatch(/Ichidan/i);
  });

  test("preserves the appliesToKanji constraint on readings", async () => {
    // WHY: a kana reading may apply to only *some* kanji spellings; dropping this link would let
    // the UI pair readings with the wrong kanji. "*" means "applies to all".
    const [top] = await dict.search("食べる");
    const word = await dict.getWord(top.id);
    expect(word!.kana[0]?.appliesToKanji).toEqual(["*"]);
  });

  test("returns null for an unknown id", async () => {
    await expect(dict.getWord("no-such-id")).resolves.toBeNull();
  });

  // ── Word-level JLPT (M6) ──────────────────────────────────────────────────

  test("tags a word with its JLPT level via the JMdict-id join", async () => {
    // WHY: the JLPT badge rests on this join. yomitan-jlpt-vocab keys words by JMdict id (= our
    // words.id), so a known N5 word (会う, entry 1198180) must carry jlpt=5. A broken join (e.g. an
    // id-scheme drift) would silently drop all JLPT tags — this catches that. The badge surfaces
    // through both the search result and the word detail, so assert both paths.
    const detail = await dict.getWord("1198180");
    expect(detail?.jlpt).toBe(5);
    const results = await dict.search("会う");
    const au = results.find((r) => r.id === "1198180");
    expect(au?.jlpt).toBe(5);
  });

  test("exposes jlpt as a strict number-or-null discriminant", async () => {
    // WHY: most JMdict entries have no JLPT level; the field must be null (badge hidden), never 0,
    // a default, or undefined, so the UI's `level === null` check reliably distinguishes "no level"
    // from a real one. Every result across a broad query must honor that discriminant.
    const results = await dict.search("学");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.jlpt === null || typeof r.jlpt === "number").toBe(true);
    }
  });

  // ── Pitch accent (M6) ─────────────────────────────────────────────────────

  test("attaches pitch accents to the matching reading", async () => {
    // WHY: pitch is keyed by (word_id, reading) and must land on the *right* reading. 食べる's
    // reading たべる is [2] (odaka); a broken join or mis-keying would drop it or attach it to the
    // wrong reading. This guards the per-reading attachment the UI badge depends on.
    const [top] = await dict.search("食べる");
    const word = await dict.getWord(top.id);
    const taberu = word!.kana.find((k) => k.text === "たべる");
    expect(taberu?.pitchAccents).toEqual([2]);
  });

  test("keeps pitch accents distinct per reading", async () => {
    // WHY: a word with multiple readings must not share one reading's accent across all — 日本語
    // has both にほんご and にっぽんご, each with its own pattern. This catches a join that keys on
    // the word instead of the (word, reading) pair.
    const [top] = await dict.search("日本語");
    const word = await dict.getWord(top.id);
    const nihongo = word!.kana.find((k) => k.text === "にほんご");
    expect(nihongo?.pitchAccents.length).toBeGreaterThan(0);
    // Every reading exposes a number[] (possibly empty), never undefined.
    for (const k of word!.kana)
      expect(Array.isArray(k.pitchAccents)).toBe(true);
  });

  // ── Example sentences (M6) ────────────────────────────────────────────────

  test("attaches example sentences to the correct sense", async () => {
    // WHY: sentences are keyed by (word_id, sense_position); they must land on the sense they
    // illustrate, not spill across senses. 食べる's first sense ("to eat") carries a ja/en pair;
    // a mis-keyed join would attach it to the wrong sense or drop it. Guards the per-sense grouping
    // the collapsible Examples UI renders.
    const [top] = await dict.search("食べる");
    const word = await dict.getWord(top.id);
    const withSentences = word!.senses.filter((s) => s.sentences.length > 0);
    expect(withSentences.length).toBeGreaterThan(0);
    const first = withSentences[0].sentences[0];
    expect(first.ja).toMatch(/[぀-ヿ㐀-鿿]/); // a real Japanese sentence
    expect(first.en.length).toBeGreaterThan(0); // paired with an English translation
  });

  test("caps example sentences per sense", async () => {
    // WHY: the inline per-sense list shows only the curated Tanaka set (source='tanaka'), capped at 3
    // per sense so a heavily-exemplified word can't bloat the detail payload. With the Tatoeba pool
    // now in the same table (up to 20/word), this cap ALSO proves getWord scopes the inline read to
    // source='tanaka' — a regression pulling pool rows into the inline list would blow past 3.
    const [top] = await dict.search("見る");
    const word = await dict.getWord(top.id);
    for (const s of word!.senses)
      expect(s.sentences.length).toBeLessThanOrEqual(3);
  });

  test("stores the Tatoeba example pool separately from the inline set (F1)", async () => {
    // WHY: F1 adds a fuller Tatoeba "more examples" pool (source='tatoeba') on top of the inline
    // Tanaka examples, deduped by Tatoeba id and furigana-annotated at build time. This guards the
    // build's invariants at the storage seam the future more-examples page reads: the pool exists, it
    // never duplicates an inline sentence for the same word, and every stored sentence carries ruby.
    const raw = await connect(DB_PATH);
    try {
      const rows = async <T>(sql: string): Promise<T[]> =>
        (await (await raw.prepare(sql)).all()) as T[];

      // The pool is populated and distinct from the inline set.
      const [counts] = await rows<{ tanaka: number; tatoeba: number }>(
        `SELECT SUM(source='tanaka') tanaka, SUM(source='tatoeba') tatoeba FROM sentences`
      );
      expect(counts.tanaka).toBeGreaterThan(0);
      expect(counts.tatoeba).toBeGreaterThan(counts.tanaka);

      // No sentence is stored as both inline and pool for one word (dedup by Tatoeba id).
      const [{ dupes }] = await rows<{ dupes: number }>(
        `SELECT COUNT(*) dupes FROM (
           SELECT word_id, tatoeba_id FROM sentences WHERE tatoeba_id IS NOT NULL
           GROUP BY word_id, tatoeba_id HAVING COUNT(DISTINCT source) > 1
         )`
      );
      expect(dupes).toBe(0);

      // Furigana is stored for every sentence (ruby markup on kanji-bearing ones).
      const [{ missing }] = await rows<{ missing: number }>(
        `SELECT COUNT(*) missing FROM sentences WHERE ja_furigana IS NULL OR ja_furigana = ''`
      );
      expect(missing).toBe(0);
      const [{ ruby }] = await rows<{ ruby: number }>(
        `SELECT COUNT(*) ruby FROM sentences WHERE ja_furigana LIKE '%{%|%}%'`
      );
      expect(ruby).toBeGreaterThan(0);
    } finally {
      await raw.close();
    }
  });

  // ── Kanji (M4) ────────────────────────────────────────────────────────────

  test("resolves a kanji character's Kanjidic data", async () => {
    // WHY: kanji detail rests on this hydration — a broken column mapping would show wrong
    // stroke counts or readings. 食 is grade 2, 9 strokes, on-reading ショク, meaning "eat".
    const kanji = await dict.getKanji("食");
    expect(kanji).not.toBeNull();
    expect(kanji!.grade).toBe(2);
    expect(kanji!.strokeCount).toBe(9);
    expect(kanji!.on).toContain("ショク");
    expect(kanji!.meanings).toContain("eat");
  });

  test("resolves a kanji's components and containing words", async () => {
    // WHY: the components come from Kradfile and the words from the precomputed char index;
    // both feed the detail view's navigation.
    const kanji = await dict.getKanji("働");
    expect(kanji!.components.length).toBeGreaterThan(0);
    const eat = await dict.getKanji("食");
    expect(eat!.words.some((w) => w.headword.includes("食"))).toBe(true);
  });

  test("flags components that have no kanji detail page", async () => {
    // WHY: tapping ノ on 久 opened "Kanji not found". Kradfile is a *visual* decomposition, not the
    // 214 Kangxi radicals, and substitutes JIS-encodable lookalikes for elements it can't encode —
    // ノ ハ マ ユ ヨ ｜. They're genuine parts (ノ is in 1,415 kanji) but Kanjidic has no entry, so
    // the UI needs to know which parts can be opened and which must go somewhere else.
    const hisashi = await dict.getKanji("久");
    const no = hisashi!.components.find((c) => c.literal === "ノ");
    expect(no?.hasDetail).toBe(false);
    // Real kanji components in the same list must stay openable.
    const iru = hisashi!.components.find((c) => c.literal === "入");
    expect(iru?.hasDetail).toBe(true);
  });

  test("builds the recursive component tree with intermediate nodes", async () => {
    // WHY: the whole reason for cjk-decomp over Kradfile. Kradfile gives 願 a FLAT set of atoms
    // (ハ 厂 小 白 目 貝 頁) with no 原; the tree must show 願 → 原 + 頁, i.e. the intermediate node
    // 原 that makes it a real breakdown. Guards against silently regressing to the flat data.
    const tree = await dict.getComponentTree("願");
    expect(tree).not.toBeNull();
    const topLevel = tree!.children.map((c) => c.literal);
    expect(topLevel).toContain("原"); // the node Kradfile omits
    expect(topLevel).toContain("頁");
    // Nodes carry annotations so the view can label them.
    const gen = tree!.children.find((c) => c.literal === "原");
    expect(gen?.meaningPreview.length).toBeGreaterThan(0);
    // And it recurses: 頁 → 貝 → 目 …
    const page = tree!.children.find((c) => c.literal === "頁");
    expect(page?.children.some((c) => c.literal === "貝")).toBe(true);
  });

  test("returns null when a kanji has no meaningful tree", async () => {
    // WHY: some kanji decompose only through stroke primitives / PUA nodes, so the pruned tree is
    // empty. The caller falls back to the flat Parts list — a null here is the signal for that, and
    // a lone-node "tree" would look broken.
    const tree = await dict.getComponentTree("一");
    expect(tree).toBeNull();
  });

  test("flags whether a kanji has a component tree", async () => {
    // WHY: the detail view's "Component tree" link is gated on this so it never opens an empty page.
    const withTree = await dict.getKanji("願");
    expect(withTree!.hasTree).toBe(true);
    const withoutTree = await dict.getKanji("一");
    expect(withoutTree!.hasTree).toBe(false);
  });

  test("returns null for a non-kanji literal", async () => {
    await expect(dict.getKanji("x")).resolves.toBeNull();
  });

  test("finds kanji by a single-character CJK query", async () => {
    // WHY: searching 食 must surface the character itself in the Kanji section, not only words.
    const kanji = await dict.searchKanji("食");
    expect(kanji.map((k) => k.literal)).toContain("食");
  });

  test("finds kanji by English meaning", async () => {
    // WHY: "eat" should surface 食 in the Kanji section alongside word results.
    const kanji = await dict.searchKanji("eat");
    expect(kanji.map((k) => k.literal)).toContain("食");
  });

  test("returns no kanji section for a kana query", async () => {
    // WHY: kana queries (たべる) are word searches; they must not populate the Kanji section.
    await expect(dict.searchKanji("たべる")).resolves.toEqual([]);
  });

  test("lists all radicals and no matches when nothing is selected", async () => {
    // WHY: the picker opens with the full radical grid and an empty match set.
    const result = await dict.lookupRadicals([]);
    expect(result.radicals.length).toBeGreaterThan(200);
    expect(result.matches).toEqual([]);
    expect(result.enabled).toEqual([]); // empty = "all enabled"
  });

  test("intersects selected radicals to matching kanji", async () => {
    // WHY: the whole feature is "narrow by components" — selecting 化 and 力 must find 働
    // (which contains both), and both radicals must stay mutually enabled.
    const result = await dict.lookupRadicals(["化", "力"]);
    expect(result.matches.some((k) => k.literal === "働")).toBe(true);
    expect(result.enabled).toContain("化");
    expect(result.enabled).toContain("力");
  });
});

const describeIfDbForVersion = existsSync(DB_PATH) ? describe : describe.skip;

describeIfDbForVersion("schema version guard", () => {
  /**
   * Run `mutate` against a throwaway copy of the fixture (so its version can be corrupted without
   * touching the fixture), then return the copy's path. Cleaned up before returning is not possible
   * — the caller opens it — so each caller removes it; a `finally` keeps that reliable.
   */
  const withCorruptedCopy = async (
    mutate: (db: Awaited<ReturnType<typeof connect>>) => Promise<void>
  ): Promise<string> => {
    const tmp = join(
      tmpdir(),
      `jisho-schema-${process.pid}-${Math.random().toString(36).slice(2)}.db`
    );
    copyFileSync(DB_PATH, tmp);
    const db = await connect(tmp);
    await mutate(db);
    await db.close();
    return tmp;
  };

  const cleanup = (tmp: string): void => {
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${tmp}${suffix}`, { force: true });
    }
  };

  test("opens a matching-version database", async () => {
    // The real fixture carries the current version, so it opens cleanly and is usable — the happy
    // path the whole delivery pipeline depends on.
    const dict = await Dictionary.open(DB_PATH);
    const results = await dict.search("食べる");
    expect(results.length).toBeGreaterThan(0);
    await dict.close();
  });

  test("refuses a database whose schema version is wrong", async () => {
    // The correctness core: a version-skewed DB (stale cache, or an artifact out of sync with the
    // shipped .vsix) must fail FAST with a typed error the delivery layer can turn into an
    // "update your dictionary" prompt — not crash deep inside a query on a missing column.
    const tmp = await withCorruptedCopy(async (db) => {
      await (
        await db.prepare(
          "INSERT OR REPLACE INTO meta(key,value) VALUES('schemaVersion',?)"
        )
      ).run(String(SCHEMA_VERSION + 999));
    });
    try {
      await expect(Dictionary.open(tmp)).rejects.toBeInstanceOf(
        SchemaVersionError
      );
    } finally {
      cleanup(tmp);
    }
  });

  test("treats a database with no version as a mismatch", async () => {
    // A DB built before schema versioning existed reports version 0 ≠ current, so it is refused
    // and re-provisioned rather than silently trusted.
    const tmp = await withCorruptedCopy(async (db) => {
      await (
        await db.prepare("DELETE FROM meta WHERE key='schemaVersion'")
      ).run();
    });
    try {
      await expect(Dictionary.open(tmp)).rejects.toBeInstanceOf(
        SchemaVersionError
      );
    } finally {
      cleanup(tmp);
    }
  });
});
