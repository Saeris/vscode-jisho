import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { segment } from "../tokenizer";

/**
 * Tokenizer behaviour over real Japanese text, not hand-picked phrases.
 *
 * Two corpora, both public domain and vendored under `bench/fixtures/` (shared with the throughput
 * bench, see docs/specs/08):
 *   - Tatoeba: 50 sampled sentences — breadth, everyday register.
 *   - 羅生門 (Akutagawa): ~5,700 chars of literary prose — depth, harder vocabulary and grammar.
 *
 * The assertions are PROPERTIES that must hold for any correct segmentation, plus SNAPSHOTS of a few
 * fixed sentences. Exact tokenizations are deliberately NOT pinned: IPADIC's output is upstream, and
 * a brittle expected-tokens list would break on any benign dictionary or folding change. Properties
 * survive that; snapshots make a real regression visible in review without asserting it up front.
 */

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../bench/fixtures/${name}`, import.meta.url)),
    "utf8"
  );

/** The 羅生門 prose lines (drop the `#` metadata header and blanks). */
const rashomonLines = fixture("rashomon.txt")
  .split("\n")
  .filter((l) => l.trim() !== "" && !l.startsWith("#"));

const tatoeba: string[] = JSON.parse(fixture("tatoeba-sample.json"));

/** Every line/sentence across both corpora, for the property checks. */
const allText = [...rashomonLines, ...tatoeba];

describe("tokenizer over a real corpus — invariants", () => {
  it("covers every non-space character: joined surfaces reproduce the input", async () => {
    // The load-bearing invariant. If concatenated segment surfaces drop or duplicate CONTENT, the
    // tokenizer corrupted the text — the kind of silent bug that makes a hover highlight the wrong
    // span or a search miss.
    //
    // Spaces are excluded from the comparison because IPADIC drops whitespace adjacent to embedded
    // Latin (下人の Sentimentalisme に → 下人のSentimentalismeに). That is a real, known limitation,
    // surfaced by this very corpus — but it only affects mixed-script prose with foreign words, and
    // no Japanese character is lost. We assert the Japanese content is intact; the space handling is
    // recorded in docs/specs/08 as a known gap rather than pinned as correct.
    const noSpace = (s: string): string => s.replace(/\s+/gu, "");
    for (const line of allText) {
      const segments = await segment(line);
      const joined = segments.map((s) => s.surface).join("");
      expect(noSpace(joined)).toBe(noSpace(line));
    }
  });

  it("never emits an empty surface", async () => {
    // An empty surface is garbage that downstream code (highlighting offsets, breakdown) mishandles
    // silently rather than crashing on. (The `pos` field is a typed enum, so it can't be blank —
    // the type guarantees what a runtime check would.)
    const offenders: string[] = [];
    for (const line of allText) {
      for (const seg of await segment(line)) {
        for (const part of seg.parts) {
          if (part.surface === "") offenders.push(line);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not shatter kanji compounds into single-character garbage", async () => {
    // A quality signal, not strict correctness: a healthy segmentation of literary prose keeps most
    // multi-kanji words intact. If the tokenizer were mis-configured (wrong dictionary, no lattice),
    // it would fall back to splitting every kanji apart. We assert the RATE of single-kanji noun
    // segments stays low over 羅生門 — a canary, tuned loose so ordinary single-kanji words pass.
    let single = 0;
    let total = 0;
    const KANJI = /^[㐀-鿿]$/u;
    for (const line of rashomonLines) {
      for (const seg of await segment(line)) {
        total++;
        if (KANJI.test(seg.surface) && seg.pos === "noun") single++;
      }
    }
    // Well under half — real prose has some single-kanji nouns (門, 火), but not a majority.
    expect(single / total).toBeLessThan(0.25);
  });
});

describe("tokenizer over a real corpus — snapshots", () => {
  // A handful of fixed sentences whose full tokenization is snapshotted. A diff here on a future
  // change is a prompt to review the segmentation, not an automatic failure of a pinned expectation.
  const pinned = [
    "ある日の暮方の事である。",
    "一人の下人が、羅生門の下で雨やみを待っていた。",
    "私は、このＣＤプレイヤーをただで得ました。"
  ];

  it.each(pinned)("segments: %s", async (sentence) => {
    const shape = (await segment(sentence)).map((s) => ({
      surface: s.surface,
      pos: s.pos,
      lemma: s.lemma
    }));
    expect(shape).toMatchSnapshot();
  });
});

describe("slang user dictionary (spec 13 §B)", () => {
  // WHY: IPADIC shatters slang it lacks (きもい → き+も+い), which reaches the dictionary as garbage.
  // Our user dictionary (src/data/slang-userdict.csv) teaches these as single words. Each entry is
  // a real IPADIC gap (probed — やばい/だるい/えぐい are already present); if the user dict fails to
  // load, these shatter and the tests catch it.
  it.each(["きもい", "うざい", "エモい", "エロい", "グロい"])(
    "tokenizes the slang adjective %s as one adjective segment",
    async (word) => {
      const segments = await segment(word);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.surface).toBe(word);
      expect(segments[0]?.pos).toBe("adjective");
    }
  );

  it.each(["ワンチャン", "コスパ", "リア充", "陰キャ", "ぼっち"])(
    "tokenizes the slang noun %s as one segment",
    async (word) => {
      const segments = await segment(word);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.surface).toBe(word);
    }
  );

  it("keeps slang isolated in a sentence without disturbing normal words", async () => {
    // WHY: a user-dict entry can over-fire; confirm it segments cleanly in context.
    const surfaces = (await segment("この虫きもい")).map((s) => s.surface);
    expect(surfaces).toEqual(["この", "虫", "きもい"]);
  });

  // WHY: the CONTRACTIONS are the risky entries — they overlap grammatical forms. These regressions
  // pin the over-firing controls that vetted them: a future edit that makes じゃんけん-style breakage
  // must fail here. The user-dict word must NOT appear where its fragments should parse normally.
  it.each([
    ["少なくとも三人はいる", "なくちゃ/なきゃ don't break 少なくとも"],
    ["手か足のどちらか", "てか doesn't break 手か"],
    ["お茶を飲む", "ちゃ-forms don't break お茶"],
    ["じゃんけんで決めよう", "no entry breaks じゃんけん"]
  ])("does not over-fire on %s", async (sentence) => {
    const surfaces = (await segment(sentence)).map((s) => s.surface);
    // None of the slang contraction surfaces should appear as a segment here.
    for (const slang of ["なくちゃ", "なきゃ", "てか", "そっか"]) {
      expect(surfaces).not.toContain(slang);
    }
  });
});
