import { describe, expect, it } from "vitest";
import { deinflect } from "../deinflect";

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
});
