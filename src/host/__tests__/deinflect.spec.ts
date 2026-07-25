import { describe, expect, it } from "vitest";
import {
  candidateMatchesPos,
  deinflect,
  deinflectCandidates
} from "../deinflect";

// Each case is a real conjugation a learner would type; the true dictionary form must be among
// the candidates. Over-generation (extra bogus candidates) is fine — the DB lookup filters it —
// but a missing true form means that conjugation can never be found.
describe("deinflect", () => {
  it("resolves polite forms to plain forms", () => {
    // WHY: 〜ます is the first form learners meet; it must reach both godan and ichidan bases.
    expect(deinflect("はなします")).toContain("はなす");
    expect(deinflect("たべます")).toContain("たべる");
    expect(deinflect("いきます")).toContain("いく");
    expect(deinflect("のみます")).toContain("のむ");
  });

  it("resolves polite past/negative chains", () => {
    // WHY: ました/ません/ませんでした chain through ます; multi-step derivations must work.
    expect(deinflect("たべました")).toContain("たべる");
    expect(deinflect("はなしません")).toContain("はなす");
    expect(deinflect("たべませんでした")).toContain("たべる");
  });

  it("resolves te-forms and plain past", () => {
    expect(deinflect("たべて")).toContain("たべる");
    expect(deinflect("かいて")).toContain("かく");
    expect(deinflect("よんで")).toContain("よむ");
    expect(deinflect("あった")).toContain("あう");
    expect(deinflect("たべた")).toContain("たべる");
  });

  it("resolves negatives", () => {
    expect(deinflect("たべない")).toContain("たべる");
    expect(deinflect("いかない")).toContain("いく");
    expect(deinflect("たべなかった")).toContain("たべる");
  });

  it("resolves い-adjective inflections", () => {
    expect(deinflect("たかくない")).toContain("たかい");
    expect(deinflect("たかかった")).toContain("たかい");
    expect(deinflect("たかくて")).toContain("たかい");
  });

  it("resolves progressive forms through the te-form", () => {
    // WHY: 〜ている/〜ています is everywhere in real text; it needs a two-step derivation.
    expect(deinflect("たべている")).toContain("たべる");
    expect(deinflect("たべています")).toContain("たべる");
  });

  it("resolves irregular する/くる forms", () => {
    expect(deinflect("します")).toContain("する");
    expect(deinflect("きました")).toContain("くる");
    expect(deinflect("こない")).toContain("くる");
  });

  it("returns no candidates for unconjugated or non-Japanese input", () => {
    // WHY: dictionary forms and English queries must pass through untouched — deinflection may
    // only ever *add* candidates, never replace the original query.
    expect(deinflect("water")).toEqual([]);
    // 食べる ends in る but no rule suffix applies beyond ones needing a longer match; any
    // candidates it does produce must not include the input itself.
    expect(deinflect("たべる")).not.toContain("たべる");
  });

  it("never deinflects the entire word away", () => {
    // WHY: a bare suffix (someone typing just ます) must not produce empty-stem candidates.
    expect(deinflect("ます")).toEqual([]);
  });

  it("resolves kanji-written irregulars", () => {
    // WHY: 来た/来ます are written with 来, so the kana rules (keyed on きた) miss them; they need
    // their own whole-word entries or the wrong verb class is produced.
    expect(deinflect("来た")).toContain("来る");
    expect(deinflect("来ます")).toContain("来る");
    expect(deinflect("来て")).toContain("来る");
  });

  it("offers the サ変 base noun, since that IS the JMdict dictionary form", () => {
    // WHY: a する-verb's JMdict entry is the stem NOUN (勉強, a vs sense), not 勉強する — searching
    // 勉強する finds nothing. The deinflection of 勉強しました must reach 勉強.
    expect(deinflect("勉強しました")).toContain("勉強");
    expect(deinflect("勉強して")).toContain("勉強");
  });
});

describe("typed deinflection conditions", () => {
  it("tags candidates with the verb class the conjugation implies", () => {
    // WHY: the whole point of the rewrite. して is する's te-form (vs) — the candidate for しる must be
    // tagged v1 so it can be rejected against 知る (a v5 verb). Class, not just "verb".
    const cands = deinflectCandidates("して");
    const suru = cands.find((c) => c.term === "する");
    expect(suru?.conditions).toContain("vs");
    const shiru = cands.find((c) => c.term === "しる");
    expect(shiru?.conditions).toContain("v1");
  });

  it("rejects a candidate whose entry is the wrong verb class", () => {
    // WHY: して → しる was tagged v1 (ichidan te-form). 知る is v5r (godan) — its te-form is しって,
    // NOT して — so 知る must be rejected. Coarse 'is a verb' would wrongly accept it.
    const shiru = deinflectCandidates("して").find((c) => c.term === "しる")!;
    expect(candidateMatchesPos(shiru, ["v5r", "vt"])).toBe(false); // 知る: rejected
    expect(candidateMatchesPos(shiru, ["v1"])).toBe(true); // a real ichidan しる: accepted
  });

  it("accepts a candidate whose entry matches the class, rejects cross-category", () => {
    // WHY: して → する (vs) must be accepted for 為る (vs-i); a noun homophone (汁) must be rejected.
    const suru = deinflectCandidates("して").find((c) => c.term === "する")!;
    expect(candidateMatchesPos(suru, ["vs-i"])).toBe(true); // 為る
    expect(candidateMatchesPos(suru, ["n"])).toBe(false); // a noun reading する
  });
});
