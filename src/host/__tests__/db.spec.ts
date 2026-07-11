import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Dictionary } from "../db";

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
