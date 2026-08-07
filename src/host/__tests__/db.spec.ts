import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Dictionary, SchemaVersionError } from "../db";
import { SCHEMA_VERSION } from "../../shared/schema";
import { exampleText } from "../../shared/exampleLinks";

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

  test("orders readings by gojuon from the stored sort key", async () => {
    // WHY: #35 — the column exists so browseable lists can be ordered in SQL. The unit tests cover
    // the normalizer; this covers the integration, which is where it would silently break: an
    // unpopulated column still sorts, just wrongly, and by codepoint katakana lands in a block
    // AFTER every hiragana entry instead of interleaved where a reader expects it.
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const stmt = raw.prepare(
      `SELECT text FROM kana
        WHERE text IN ('ラーメン', 'あめ', 'コーヒー', 'ひと')
        ORDER BY sort_key`
    );
    const rows = stmt.all() as { text: string }[];
    const seen = [...new Set(rows.map((r) => r.text))];
    expect(seen).toEqual(["あめ", "コーヒー", "ひと", "ラーメン"]);

    const empty = raw
      .prepare("SELECT COUNT(*) AS n FROM kana WHERE sort_key = ''")
      .get() as { n: number };
    expect(empty.n).toBe(0);
  });

  test("classifies radicals into the seven positional categories", async () => {
    // WHY: spec 04's picker filter offers these seven as the lookup axis, so a wrong category sends
    // a learner to the wrong shelf. Note the KEYS: Radkfile stores variant radicals under an
    // EXEMPLAR KANJI, not the component glyph — 亻 is filed as 化 and ⻌ as 込 — which is why the
    // build derives the component from a radical's MEMBERS rather than from the key itself. Looking
    // these up as "亻"/"⻌" returns no row at all, which is how the mismatch first surfaced.
    const radicals = (await dict.lookupRadicals([])).radicals;
    const positionOf = (key: string): string | null =>
      radicals.find((r) => r.radical === key)?.position ?? null;
    expect(positionOf("化")).toBe("hen"); // 亻
    expect(positionOf("込")).toBe("nyo"); // ⻌
    expect(positionOf("宀")).toBe("kanmuri");
    expect(positionOf("囗")).toBe("kamae");

    // Every non-null value must be one of the seven; a typo in the build would otherwise reach the
    // UI as a filter chip that matches nothing.
    const allowed = new Set([
      "hen",
      "tsukuri",
      "kanmuri",
      "ashi",
      "kamae",
      "tare",
      "nyo"
    ]);
    const bad = radicals.filter(
      (r) => r.position !== null && !allowed.has(r.position)
    );
    expect(bad).toEqual([]);
  });

  test("keeps the denormalized uk flag in step with its tag rows", async () => {
    // WHY: words.is_uk is a build-time denormalization of "any sense tagged uk", and sense_tags is
    // where that tag actually lives. Two representations of one fact drift the moment someone edits
    // one path and not the other, and the failure is silent — is_uk only changes which heading a
    // result leads with. Compares CARDINALITY rather than the sets themselves: a per-row EXISTS
    // check is a full scan (~45s), while both counts below are indexed. A build that stopped
    // populating either side, or populated them from different predicates, diverges here.
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const stmt = raw.prepare(
      `SELECT (SELECT COUNT(*) FROM words WHERE is_uk = 1) AS flagged,
              (SELECT COUNT(DISTINCT s.word_id)
                 FROM sense_tags t JOIN senses s ON s.id = t.sense_id
                WHERE t.kind = 'misc' AND t.code = 'uk') AS tagged`
    );
    const row = stmt.get() as { flagged: number; tagged: number };
    expect(row.flagged).toBeGreaterThan(0);
    expect(row.flagged).toBe(row.tagged);
  });

  test("resolves a lemma by index rather than scanning", async () => {
    // WHY: this is the editor hover's lookup, so it runs on cursor movement — and it regressed to a
    // flat 283ms because it filtered `kanji.text`/`kana.text`, neither of which is indexed, and so
    // scanned a whole join product. Nothing caught it: a scan looks identical to a lookup except in
    // wall time, and 283ms reads as "the dictionary is just slow".
    //
    // The threshold is deliberately enormous (~250x the measured 0.2ms) so it cannot flake on a
    // loaded CI runner. It is not a micro-benchmark; it only asserts that this path is still
    // index-shaped, which is the difference between sub-millisecond and hundreds of milliseconds.
    const start = performance.now();
    for (const [lemma, reading] of [
      ["する", "スル"],
      ["食べる", "タベル"],
      ["本", "ホン"]
    ] as const) {
      await dict.resolveByLemma(lemma, "verb", reading);
    }
    const perCall = (performance.now() - start) / 3;
    expect(perCall).toBeLessThan(50);
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

  test("pos-validated deinflection rejects grammatically-invalid candidates", async () => {
    // WHY: the typed-transform rewrite. Old over-generation surfaced 知る for して (a v5 verb whose
    // te-form is しって, not して) and 汁 (a noun) — both are grammatically-invalid deinflections.
    // The class-tagged candidates + POS validation reject them, so する (為る) surfaces instead.
    const shite = await dict.search("して", 10);
    // する's entry (為る) now heads with the kana する — it's `uk` with an uncommon kanji writing.
    const suruIndex = shite.findIndex((r) => r.headword === "する");
    const shiruIndex = shite.findIndex((r) => r.headword === "知る");
    expect(suruIndex).toBeGreaterThanOrEqual(0); // する is found
    // 知る must NOT appear as a deinflection of して (wrong verb class).
    expect(shiruIndex).toBe(-1);
  });

  test("resolves サ変 verbs to their base-noun entry (勉強した → 勉強)", async () => {
    // WHY: a する-verb's JMdict dictionary form is the stem NOUN (勉強, a vs sense) — 勉強する has no
    // entry. Deinflecting 勉強した must reach 勉強, or the conjugated サ変 form is unsearchable.
    const results = await dict.search("勉強した");
    expect(results.some((r) => r.headword === "勉強")).toBe(true);
  });

  test("resolves kanji-written irregular verbs (来た → 来る)", async () => {
    // WHY: 来る written with 来 conjugates the same but the kana rules key on きた; without a
    // kanji-form entry, 来た produces the wrong verb class and is rejected.
    const results = await dict.search("来た");
    expect(results.some((r) => r.headword === "来る")).toBe(true);
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

  // ── POS-aware hover resolution (accuracy fix) ─────────────────────────────

  test("resolveByLemma picks the entry the tokenizer POS implies, not the frequent homophone", async () => {
    // WHY: the hover false-positive. Searching the STRING する returned 擦る ("to rub", freq-ranked)
    // over 為る (する = "to do") — because 為る is usually written kana, so its kanji form was never
    // frequency-ranked. resolveByLemma uses the tokenizer's (lemma, POS) directly: a verb lemma する
    // must resolve to the DO-verb, not to-rub. This is the exact regression the fix targets.
    const suru = await dict.resolveByLemma("する", "verb");
    expect(suru?.glossPreview).toMatch(/to do/);
    // A verb lemma must NOT resolve to a same-reading NOUN — し (する's stem lemma) → the verb, not 死.
    const shi = await dict.resolveByLemma("する", "verb");
    expect(shi?.glossPreview).not.toMatch(/death/);
  });

  test("resolveByLemma respects the coarse POS category", async () => {
    // WHY: 勉強 is both a noun ("study") and a suru-verb; the tokenizer disambiguates by context, and
    // resolveByLemma must honor it — a noun lemma resolves the noun sense's entry, not a verb.
    const noun = await dict.resolveByLemma("勉強", "noun");
    expect(noun?.headword).toBe("勉強");
    // An adjective lemma resolves the adjective (いい "good"), the everyday word.
    const adj = await dict.resolveByLemma("いい", "adjective");
    expect(adj?.headword).toBe("いい");
  });

  test("resolveByLemma prefers an exact kanji writing", async () => {
    // WHY: when the lemma has kanji, the writing is the strongest identity — 食べる resolves 食べる.
    const taberu = await dict.resolveByLemma("食べる", "verb");
    expect(taberu?.headword).toBe("食べる");
  });

  test("resolveByLemma disambiguates a homograph by the tokenizer's reading", async () => {
    // WHY: the accuracy corpus caught this. 本 is a kanji WRITING shared by two entries: 本 (ほん,
    // "book") and 元 (もと, whose writings include 本). Ranking by frequency alone picked 元 (freq 5)
    // over 本 (freq null) — resolving 本 to the wrong word. The tokenizer KNOWS the reading is ほん, so
    // an entry read ほん must beat one that merely shares the writing but reads もと. The reading tier
    // is what fixes 本/元, 風/振り, 息/息子 across the board.
    const book = await dict.resolveByLemma("本", "noun", "ホン");
    expect(book?.headword).toBe("本");
    expect(book?.reading).toBe("ほん");
    // Same lemma, the OTHER reading (もと) must resolve the もと entry, not 本 — proving the tier keys
    // on the reading, not a fixed preference.
    const moto = await dict.resolveByLemma("本", "noun", "モト");
    expect(moto?.reading).toBe("もと");
    // No reading supplied → the tier stays off; it still resolves the writing (falls through to the
    // prior ranking) rather than returning null.
    await expect(dict.resolveByLemma("本", "noun")).resolves.not.toBeNull();
  });

  test("resolveByLemma returns null for an unknown lemma", async () => {
    // WHY: the caller falls back to `search` only when this returns null, so an unmatched lemma must.
    await expect(
      dict.resolveByLemma("ぬてぬてぬて", "noun")
    ).resolves.toBeNull();
  });

  test("resolveByLemma strips a glued honorific お/ご to reach the base noun", async () => {
    // WHY: IPADIC glues お/ご into a kango noun's lemma (お会議, ご確認), which has no entry, so direct
    // resolution returns null. A null-only fallback retries with the prefix stripped — お会議→会議.
    // Null-only means it can't regress a working case, and lexicalized honorifics (お茶/お名前 — which
    // ARE entries) resolve directly and never reach the fallback, so they keep their own heading.
    //
    // The examples must be forms JMdict does NOT carry as entries of their own. お電話/ご案内 were
    // used here until a full-dictionary build turned out to contain both — at which point they
    // resolve directly and stop exercising this path at all. Whether a given honorific is
    // lexicalized is upstream data that can change on any dictionary refresh, so the assertion
    // below pins the BEHAVIOUR (prefixed form reaches the base) using forms verified absent.
    expect((await dict.resolveByLemma("お会議", "noun"))?.headword).toBe(
      "会議"
    );
    expect((await dict.resolveByLemma("ご確認", "noun"))?.headword).toBe(
      "確認"
    );
    // Lexicalized: お茶 IS its own entry, so it stays お茶 (the fallback never fires).
    expect((await dict.resolveByLemma("お茶", "noun"))?.headword).toBe("お茶");
  });

  test("resolveByLemma breaks a kana-homophone tie by sense breadth, not frequency", async () => {
    // WHY: the accuracy sweep caught this. なる resolves to two v5r entries sharing the reading:
    // 成る ("become", 11 senses) and 生る ("bear fruit", 1 sense). freq_rank picked 生る — because it
    // scores the KANJI 生's newspaper frequency (生 is everywhere: 生きる, 学生…), not the word's. The
    // everyday word is the many-sensed one, so sense breadth must outrank frequency here.
    const naru = await dict.resolveByLemma("なる", "verb", "ナル");
    expect(naru?.headword).toBe("成る");
    expect(naru?.glossPreview).toMatch(/become/);
  });

  test("shows the kana headword for a usually-kana (uk) word", async () => {
    // WHY: reported from live hovers. ここ/ちょっと/ありがとう are `uk` — their canonical WRITTEN form is
    // the kana, and the kanji (此処/一寸/有難う) is archaic. Heading a hover with 此処 for ここ is
    // needlessly confusing. A `uk` entry must show the kana as its headword, with no redundant reading
    // line (the kana reads itself); a NON-uk word keeps its kanji heading + reading.
    const koko = await dict.resolveByLemma("ここ", "noun", "ココ");
    expect(koko?.headword).toBe("ここ");
    expect(koko?.reading).toBe(""); // kana heading needs no separate reading
    const chotto = await dict.resolveByLemma("ちょっと", "adverb", "チョット");
    expect(chotto?.headword).toBe("ちょっと");
    // Control: a non-uk word still leads with kanji and carries its reading.
    const taberu = await dict.resolveByLemma("食べる", "verb", "タベル");
    expect(taberu?.headword).toBe("食べる");
    expect(taberu?.reading).toBe("たべる");
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

  // ── Kanji-level JLPT, modern N5–N1 scale (#55) ────────────────────────────

  test("stores the modern kanji JLPT scale separately from Kanjidic's old one", async () => {
    // WHY: `jlpt` (Kanjidic, pre-2010 four-level) and `jlpt_n` (N5–N1) are DIFFERENT DATA, not two
    // encodings of the same thing — 水 is old-4/N5 and 私 old-3/N4, both shifting by one, while 顔 is
    // old-3/N3 and does not. Overwriting one with the other would silently corrupt whichever
    // consumer wanted the other, so this pins that both survive and that 顔 is the case proving the
    // shift is not uniform.
    const levels = await Promise.all(
      ["水", "私", "顔"].map(async (literal) => ({
        literal,
        list: await dict.browseKanjiList("kanji-jlpt-n5")
      }))
    );
    // 水 is N5; 私 and 顔 are not, so only 水 appears in the N5 list.
    const n5 = new Set(levels[0].list.map((k) => k.literal));
    expect(n5.has("水")).toBe(true);
    expect(n5.has("私")).toBe(false);
    expect(n5.has("顔")).toBe(false);

    // And they land where the modern scale says, not where Kanjidic's old one would put them.
    const n4 = await dict.browseKanjiList("kanji-jlpt-n4");
    expect(n4.some((k) => k.literal === "私")).toBe(true);
    const n3 = await dict.browseKanjiList("kanji-jlpt-n3");
    expect(n3.some((k) => k.literal === "顔")).toBe(true);
  });

  test("carries every JLPT kanji level, at the counts the source publishes", async () => {
    // WHY: the browse lists are only as good as this import, and the failure mode is a list that is
    // silently SHORT — a user cannot tell "N3 has 367 kanji" from "N3 has 40 and the parse broke".
    // The build asserts the same numbers against the upstream file; this asserts they reached the
    // database. Kanji at two levels would make the lists overlap, so uniqueness is pinned too.
    const expected = [
      ["kanji-jlpt-n5", 79],
      ["kanji-jlpt-n4", 166],
      ["kanji-jlpt-n3", 367],
      ["kanji-jlpt-n2", 367],
      ["kanji-jlpt-n1", 1232]
    ] as const;
    const seen = new Set<string>();
    let total = 0;
    for (const [id, count] of expected) {
      const list = await dict.browseKanjiList(id);
      expect(list).toHaveLength(count);
      total += list.length;
      for (const k of list) {
        expect(seen.has(k.literal)).toBe(false);
        seen.add(k.literal);
      }
    }
    expect(total).toBe(2211);
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
    expect(first.jaFurigana).toMatch(/[぀-ヿ㐀-鿿]/); // a real Japanese sentence
    expect(first.en.length).toBeGreaterThan(0); // paired with an English translation
  });

  test("inline examples carry the markup layers, not a half-stripped string", async () => {
    // WHY: the DTO must hand the renderer the SAME markup the pool page gets, because `ExampleSentence`
    // is what turns it into furigana and tap targets. The old assertion here ("matches a Japanese
    // character") could not fail for the bug that actually shipped: getWord stripped ruby but not
    // F1-links, so `[もっと](adv:1012620)` reached the page — and that string matches a Japanese
    // character just fine. So assert the two layers are intact AND that plain text is still
    // derivable, which is what the hover needs.
    const [top] = await dict.search("食べる");
    const word = await dict.getWord(top.id);
    const sentences = word!.senses.flatMap((s) => s.sentences);
    const linked = sentences.filter((s) => s.jaFurigana.includes("]("));
    expect(linked.length).toBeGreaterThan(0);
    for (const s of linked) {
      expect(exampleText(s.jaFurigana)).not.toMatch(/[[\]{}]/u);
    }
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
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const rows = async <T>(sql: string): Promise<T[]> =>
      raw.prepare(sql).all() as T[];

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
  });

  test("getMoreExamples returns the pool with furigana, grouped (F1)", async () => {
    // WHY: the "more examples" page reads getMoreExamples, which must (a) return ONLY the Tatoeba
    // pool (not the inline Tanaka set), (b) carry build-time furigana, and (c) separate sense-tagged
    // sentences from the word-level bucket. A word with a big pool (食べる) exercises all three.
    const [top] = await dict.search("食べる");
    const more = await dict.getMoreExamples(top.id);
    expect(more).not.toBeNull();
    expect(more!.headword).toContain("食");

    const all = [
      ...more!.senses.flatMap((g) => g.sentences),
      ...more!.wordLevel
    ];
    expect(all.length).toBeGreaterThan(0);
    // Every pool sentence carries ruby markup and an English translation.
    for (const s of all) {
      expect(s.jaFurigana).toMatch(/\{.+\|.+\}/); // at least one furigana group
      expect(s.en.length).toBeGreaterThan(0);
    }
    // A sense group, when present, is labelled with its gloss.
    for (const g of more!.senses) expect(g.gloss.length).toBeGreaterThan(0);
  });

  test("getWord's poolExamples matches what the pool page would show", async () => {
    // WHY: the word page hides the "more examples" link when this count is too low, so if it ever
    // disagreed with getMoreExamples the link would either hide a real page or offer a blank one —
    // which is the bug that shipped (the link rendered unconditionally, and 47.8% of words in the
    // shipped dictionary have no pool at all). Tying the two together here is what keeps the
    // decision honest, since they are separate queries against the same table.
    for (const term of ["食べる", "見る"]) {
      const [top] = await dict.search(term);
      const word = await dict.getWord(top.id);
      const more = await dict.getMoreExamples(top.id);
      const shown =
        (more?.senses.flatMap((g) => g.sentences).length ?? 0) +
        (more?.wordLevel.length ?? 0);
      expect(word!.poolExamples).toBe(shown);
    }
  });

  test("poolExamples is 0 for a word with no pool, so the link can hide", async () => {
    // WHY: the empty case is the one the user actually hit, and it is not rare — nearly half the
    // dictionary. A word whose pool is empty must report 0 rather than, say, falling back to the
    // inline count, or the link would still render and still lead nowhere.
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const [row] = raw
      .prepare(
        `SELECT w.id FROM words w
          WHERE NOT EXISTS (
            SELECT 1 FROM sentences WHERE word_id = w.id AND source = 'tatoeba')
          LIMIT 1`
      )
      .all() as { id: string }[];
    const word = await dict.getWord(row.id);
    expect(word!.poolExamples).toBe(0);
    await expect(dict.getMoreExamples(row.id)).resolves.toBeNull();
  });

  test("getMoreExamples excludes the inline Tanaka sentences (F1)", async () => {
    // WHY: the page is the POOL — the inline per-sense examples already show on the word page, so a
    // sentence stored as source='tanaka' must never appear here (that's what getWord shows). Compare
    // against the raw table: no getMoreExamples sentence shares a Tatoeba id with a tanaka row.
    const [top] = await dict.search("食べる");
    const more = await dict.getMoreExamples(top.id);
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const tanaka = raw
      .prepare(
        "SELECT ja_furigana FROM sentences WHERE word_id = ? AND source = 'tanaka'"
      )
      .all(top.id) as { ja_furigana: string }[];
    const tanakaSet = new Set(tanaka.map((r) => r.ja_furigana));
    const poolJa = [
      ...(more?.senses.flatMap((g) => g.sentences) ?? []),
      ...(more?.wordLevel ?? [])
    ].map((s) => s.jaFurigana);
    for (const ja of poolJa) expect(tanakaSet.has(ja)).toBe(false);
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

  test("orders a kanji's word list by frequency within common (F2)", async () => {
    // WHY: `common DESC` alone left ties arbitrary, so a rare common-tagged compound (水俣病) could
    // sit above an everyday word (水). The freq_rank tiebreak must float the frequent words. Assert
    // the ordering INVARIANT (holds on any variant): among the returned words, once a less-common one
    // appears no more-common one follows it, and the frequency-ranked words lead the unranked ones.
    // A word's own `common` flag and rank aren't on the DTO, so re-derive the guarantee from the DB.
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const rows = raw
      .prepare(
        `SELECT MAX(s.is_common) AS common, w.freq_rank AS rank
           FROM search_terms s JOIN words w ON w.id = s.word_id
          WHERE s.kind = 'char' AND s.term = '生'
          GROUP BY s.word_id
          ORDER BY common DESC, w.freq_rank IS NULL, w.freq_rank ASC
          LIMIT 10`
      )
      .all() as { common: number; rank: number | null }[];
    expect(rows.length).toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      // common never increases going down the list.
      expect(cur.common).toBeLessThanOrEqual(prev.common);
      // Within the same common tier, a ranked word never follows an unranked one, and ranks are
      // non-decreasing (more frequent first).
      if (cur.common === prev.common) {
        if (prev.rank === null) expect(cur.rank).toBeNull();
        else if (cur.rank !== null)
          expect(cur.rank).toBeGreaterThanOrEqual(prev.rank);
      }
    }
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

  test("surfaces visually-similar kanji, ranked and with meanings (F3)", async () => {
    // WHY: the "similar kanji" section rests on the precomputed similar_kanji table (Yencken data for
    // jōyō). The classic learner confusion 未/末 must appear near the top — a broken join or a wrong
    // ORDER BY position would hide it or scramble the ranking. Each entry is an openable kanji and
    // carries a short meaning (the tile label that distinguishes look-alikes from parts).
    const mi = await dict.getKanji("未");
    // Ranked most-similar-first: 末 (a near-identical look-alike) leads.
    const top = mi!.similar[0];
    expect(top).toBeDefined();
    expect(top?.literal).toBe("末");
    // Each entry carries a one-word meaning for its tile.
    expect(top?.meaning.length).toBeGreaterThan(0);
    // Every similar kanji resolves to its own detail (the table FK-references kanji_characters).
    const first = await dict.getKanji(top?.literal ?? "");
    expect(first).not.toBeNull();
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

  test("returns every kanji of a multi-character query, in query order", async () => {
    // WHY: searching 図書館 is asking about all three characters, and the Kanji section is read
    // alongside the word — so it must list them in the order they appear in the word, not in
    // whatever order the rows come back from SQLite. The hydrator re-sorts to the caller's order
    // precisely because `IN (...)` does not preserve it: asked for 図書館, SQLite returns 図 学 語
    // -shaped index order for a mixed set.
    const kanji = await dict.searchKanji("図書館");
    expect(kanji.map((k) => k.literal)).toEqual(["図", "書", "館"]);
  });

  test("keeps the first position of a repeated character", async () => {
    // WHY: 日本日 must not render 日 twice — a duplicate row reads as a data bug — and the survivor
    // is the FIRST occurrence, so the section still tracks the order the reader sees.
    const kanji = await dict.searchKanji("日本日");
    expect(kanji.map((k) => k.literal)).toEqual(["日", "本"]);
  });

  test("drops CJK characters that have no kanji entry", async () => {
    // WHY: 龘 is a real CJK ideograph that Kanjidic does not carry. It must vanish from the section
    // rather than render an empty row. This is the case the removed per-character existence query
    // used to handle; hydration drops unknown literals on its own, and this pins that.
    const kanji = await dict.searchKanji("語龘学");
    expect(kanji.map((k) => k.literal)).toEqual(["語", "学"]);
  });

  test("returns nothing when no character of the query is a known kanji", async () => {
    // WHY: an all-unknown query must produce an empty section, not a section of blank rows.
    await expect(dict.searchKanji("龘")).resolves.toEqual([]);
  });

  test("ignores iteration marks and kana mixed into a kanji query", async () => {
    // WHY: 人々 is one word to a reader but 々 has no kanji entry, so only 人 is a lookup target.
    // Kana in the same query (人と本) is likewise not a kanji.
    expect((await dict.searchKanji("人々")).map((k) => k.literal)).toEqual([
      "人"
    ]);
    expect((await dict.searchKanji("人と本")).map((k) => k.literal)).toEqual([
      "人",
      "本"
    ]);
  });

  test("caps a long kanji query at the limit, before hydrating", async () => {
    // WHY: the section is a sidebar list, not a dump of every character in a pasted sentence. The
    // cap is asserted at BOTH the explicit limit and the default, because a cap applied only when
    // the caller names one still floods the section on the path the UI actually uses.
    const capped = await dict.searchKanji("日本人学生図書館語食", 3);
    expect(capped.map((k) => k.literal)).toEqual(["日", "本", "人"]);

    // Ten distinct kanji against the default limit of 8.
    const defaulted = await dict.searchKanji("日本人学生図書館語食");
    expect(defaulted).toHaveLength(8);
  });

  test("counts a surrogate-pair character as one character", async () => {
    // WHY: 𠮷 (U+20BB7) is two UTF-16 units. Iterating by unit rather than code point would split
    // it into two lone surrogates. Neither half is matched by the kanji class, so the visible
    // result is the same either way — what this pins is that the SPLIT does not corrupt the
    // characters around it, which is where a unit-wise walk actually goes wrong.
    await expect(dict.searchKanji("\u{20BB7}")).resolves.toEqual([]);
    expect(
      (await dict.searchKanji("語\u{20BB7}学")).map((k) => k.literal)
    ).toEqual(["語", "学"]);
    // Kanji beyond the BMP are out of scope for CJK-query lookup regardless: `isKanjiChar` covers
    // U+3400-U+9FFF and the compatibility block, so the eight ext-B literals the dictionary does
    // carry (𠮟 and friends) are reachable by browse, never by typing them here.
  });

  test("hydrates the same fields however the kanji was found", async () => {
    // WHY: a kanji reached by CJK query and the same kanji reached by meaning are the same thing
    // arrived at two ways (the shared `kanjiResults` hydrator) — the row must not differ.
    const [viaLiteral] = await dict.searchKanji("食");
    const viaMeaning = (await dict.searchKanji("eat")).find(
      (k) => k.literal === "食"
    );
    expect(viaLiteral).toEqual(viaMeaning);
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

const describeIfDbForLinks = existsSync(DB_PATH) ? describe : describe.skip;

/**
 * Accuracy guard for the example-sentence annotation (#38).
 *
 * This markup is DERIVED at build time — Tatoeba ships neither the part-of-speech tags nor the
 * entry links, we compute both from the tokenizer plus a JMdict resolver. That makes it the kind of
 * data that can silently degrade: a tokenizer upgrade, a JMdict release, or a resolver tweak could
 * start pointing 彼 at the wrong entry and nothing else in the suite would notice. These run
 * against the built DB so the check repeats on every build, which is the point.
 *
 * They assert PROPERTIES rather than exact ids: entry ids are stable but the corpus is not, so
 * pinning specific sentences would break on a data refresh for no good reason.
 */
describeIfDbForLinks("example annotation accuracy", () => {
  const TOKEN = /\[([^\]]+)\]\(([a-z]+):(\d*)\)/gu;
  const stripRuby = (s: string): string =>
    s.replace(/\{([^|{}]+)\|[^{}]+\}/gu, "$1");

  /** Every annotated token in the corpus: surface, POS code, and entry id (empty when unlinked). */
  const tokens = async (): Promise<
    { surface: string; code: string; id: string }[]
  > => {
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const rows = raw.prepare("SELECT ja_furigana FROM sentences").all() as {
      ja_furigana: string;
    }[];
    const out: { surface: string; code: string; id: string }[] = [];
    for (const r of rows) {
      for (const m of r.ja_furigana.matchAll(TOKEN)) {
        out.push({ surface: stripRuby(m[1]), code: m[2], id: m[3] });
      }
    }
    return out;
  };

  test("links pronouns, and every link points at a pronoun entry", async () => {
    // WHY (user request): 彼/私/あなた are real dictionary words a reader may want to look up, so
    // they earn links — but only if the link is RIGHT. The resolver's take-the-first rule sent 彼
    // to the あれ "that" entry and 君 to the honorific suffix "Mr", which is why linking them
    // required POS-confirmed resolution first. A wrong link is worse than no link: it silently
    // teaches the wrong word.
    const pn = (await tokens()).filter((t) => t.code === "pn");
    expect(pn.length).toBeGreaterThan(0);
    const linked = pn.filter((t) => t.id !== "");
    // Measured at 93.6%. A floor, not a target: the unlinked remainder is mostly segments where the
    // tokenizer merged in trailing material, which `INVARIANT_POS` deliberately refuses to link.
    // Dropping much below this would mean resolution broke; rising toward 100% would mean the
    // exactness check stopped firing.
    expect(linked.length / pn.length).toBeGreaterThan(0.9);

    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const stmt = raw.prepare(
      `SELECT 1 FROM sense_tags t JOIN senses s ON s.id = t.sense_id
        WHERE s.word_id = ? AND t.kind = 'pos' AND t.code = 'pn' LIMIT 1`
    );
    // Check every DISTINCT target rather than every occurrence — same coverage, far fewer queries.
    for (const id of new Set(linked.map((t) => t.id))) {
      expect(stmt.get(id)).toBeDefined();
    }
  });

  test("links adnominals only to entries tagged adj-pn", async () => {
    // WHY: adnominals (この, その, 大きな) are the category the author flagged as most likely to
    // mismatch — 大きな and ある have common non-adnominal homographs. `POS_CONFIRM` requires the
    // `adj-pn` tag, so a surface whose entries are all some other part of speech stays UNLINKED
    // (still coloured) rather than linking somewhere plausible-looking and wrong.
    const adn = (await tokens()).filter((t) => t.code === "adn");
    expect(adn.length).toBeGreaterThan(0);

    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const stmt = raw.prepare(
      `SELECT 1 FROM sense_tags t JOIN senses s ON s.id = t.sense_id
        WHERE s.word_id = ? AND t.kind = 'pos' AND t.code = 'adj-pn' LIMIT 1`
    );
    for (const id of new Set(adn.filter((t) => t.id !== "").map((t) => t.id))) {
      expect(stmt.get(id)).toBeDefined();
    }
  });

  test("a closed-class link's surface IS the word, not a longer segment", async () => {
    // WHY: pronouns and adnominals never inflect, so a linked span longer than every form of its
    // target means the tokenizer merged in trailing material and the link points somewhere the
    // reader did not tap — measured at 8.9% of adnominal and 5.7% of pronoun links before the
    // `INVARIANT_POS` check (そのこと → その, この時 → この, あの方たち → あの).
    //
    // This must NOT be generalised to verbs or adjectives: 食べました legitimately links to 食べる,
    // and that longer span is precisely what the word-boundary work is for.
    const closed = (await tokens()).filter(
      (t) => (t.code === "pn" || t.code === "adn") && t.id !== ""
    );
    expect(closed.length).toBeGreaterThan(0);

    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const stmt = raw.prepare(
      `SELECT text FROM kanji WHERE word_id = ?1
        UNION SELECT text FROM kana WHERE word_id = ?1`
    );
    const formsOf = new Map<string, Set<string>>();
    const mismatched: string[] = [];
    for (const t of closed) {
      let forms = formsOf.get(t.id);
      if (forms === undefined) {
        forms = new Set(
          (stmt.all(t.id) as { text: string }[]).map((r) => r.text)
        );
        formsOf.set(t.id, forms);
      }
      if (!forms.has(t.surface)) mismatched.push(t.surface);
    }
    expect(mismatched).toEqual([]);
  });

  test("never links particles or auxiliaries", async () => {
    // WHY: the colour/link split. Particles are 29% of all tokens — linking them would bury the
    // links that are actually useful, and a JMdict entry for は teaches nothing. They must carry a
    // POS (so they colour) and never an id.
    const closed = (await tokens()).filter(
      (t) => t.code === "p" || t.code === "aux"
    );
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.filter((t) => t.id !== "")).toEqual([]);
  });

  test("annotates the great majority of each sentence", async () => {
    // WHY: this is the coverage the whole change bought — 68.7% of characters before, since only
    // the four linkable content categories carried a POS. A regression here means the palette has
    // quietly stopped describing the sentence, which is hard to see in a screenshot but obvious in
    // a number.
    using raw = new DatabaseSync(DB_PATH, { readOnly: true });
    const rows = raw
      .prepare("SELECT ja_furigana FROM sentences LIMIT 20000")
      .all() as { ja_furigana: string }[];
    let annotated = 0;
    let total = 0;
    for (const r of rows) {
      total += stripRuby(r.ja_furigana.replace(TOKEN, "$1")).length;
      for (const m of r.ja_furigana.matchAll(TOKEN)) {
        annotated += stripRuby(m[1]).length;
      }
    }
    // Measured at 93.4%; the remainder is punctuation and `other`, which carry no claim.
    expect(annotated / total).toBeGreaterThan(0.9);
  });
});

const describeIfDbForVersion = existsSync(DB_PATH) ? describe : describe.skip;

describeIfDbForVersion("schema version guard", () => {
  /**
   * Run `mutate` against a throwaway copy of the fixture (so its version can be corrupted without
   * touching the fixture), then return the copy's path. Cleaned up before returning is not possible
   * — the caller opens it — so each caller removes it; a `finally` keeps that reliable.
   */
  const withCorruptedCopy = (mutate: (db: DatabaseSync) => void): string => {
    const tmp = join(
      tmpdir(),
      `jisho-schema-${process.pid}-${Math.random().toString(36).slice(2)}.db`
    );
    copyFileSync(DB_PATH, tmp);
    // `using` so a throwing `mutate` still releases the handle: on Windows an open connection makes
    // the temp file undeletable, and `cleanup` would then fail with EPERM, masking the real
    // assertion failure.
    using db = new DatabaseSync(tmp);
    mutate(db);
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
    const tmp = withCorruptedCopy((db) => {
      db.prepare(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('schemaVersion',?)"
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
    const tmp = withCorruptedCopy((db) => {
      db.prepare("DELETE FROM meta WHERE key='schemaVersion'").run();
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
