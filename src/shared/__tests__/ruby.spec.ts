import { describe, expect, it } from "vitest";
import { stripRuby } from "../../host/hover";
import { alignReading, toRubyHtml, toRubyMarkdown } from "../ruby";

describe("alignReading", () => {
  it("gives each kanji run only its own share of the reading", () => {
    // WHY: the whole point of the utility. {食べる|たべる} would put the okurigana inside the
    // annotation, teaching that べる is part of the character's reading — it isn't.
    expect(alignReading("食べる", "たべる")).toEqual([
      { text: "食", ruby: "た" },
      { text: "べる" }
    ]);
  });

  it("splits readings across kanji runs separated by okurigana", () => {
    // WHY: multi-run words are where naive whole-word annotation is most wrong — 買い物 needs
    // か on 買 and もの on 物, not かいもの smeared over both.
    expect(alignReading("買い物", "かいもの")).toEqual([
      { text: "買", ruby: "か" },
      { text: "い" },
      { text: "物", ruby: "もの" }
    ]);
    expect(alignReading("取り扱い", "とりあつかい")).toEqual([
      { text: "取", ruby: "と" },
      { text: "り" },
      { text: "扱", ruby: "あつか" },
      { text: "い" }
    ]);
  });

  it("treats an all-kanji word as one run", () => {
    expect(alignReading("日本語", "にほんご")).toEqual([
      { text: "日本語", ruby: "にほんご" }
    ]);
  });

  it("returns null when there is no kanji or the reading cannot match", () => {
    // WHY: null is the signal callers use to fall back — annotating katakana or a mismatched
    // reading with invented spans would be worse than annotating coarsely.
    expect(alignReading("コーヒー", "こーひー")).toBeNull();
    expect(alignReading("ひらがな", "ひらがな")).toBeNull();
    expect(alignReading("食べる", "のむ")).toBeNull();
  });

  it("matches katakana readings against kana surfaces", () => {
    // WHY: the tokenizer hands back katakana readings (ミセ), while surfaces carry hiragana
    // okurigana — without normalising, every conjugated verb would fail to align.
    expect(alignReading("見せる", "ミセル")).toEqual([
      { text: "見", ruby: "み" },
      { text: "せる" }
    ]);
  });
});

describe("toRubyMarkdown", () => {
  it("wraps only the kanji runs", () => {
    expect(toRubyMarkdown("食べる", "たべる")).toBe("{食|た}べる");
    expect(toRubyMarkdown("買い物", "かいもの")).toBe("{買|か}い{物|もの}");
  });

  it("falls back to whole-word annotation when alignment fails", () => {
    // WHY: a coarse-but-correct reading still helps the reader; silently dropping it doesn't.
    expect(toRubyMarkdown("食べる", "のむ")).toBe("{食べる|のむ}");
  });

  it("leaves text alone when there is nothing to annotate", () => {
    expect(toRubyMarkdown("ひらがな", "ひらがな")).toBe("ひらがな");
    expect(toRubyMarkdown("食べる", "")).toBe("食べる");
  });

  it("round-trips through stripRuby back to the original surface", () => {
    // WHY: this is the contract between the writer and every reader we already ship — the hover,
    // highlighting, and spacing all parse ruby with stripRuby. If output here doesn't survive
    // that parse, annotating a document silently breaks every other feature on it.
    for (const [surface, reading] of [
      ["食べる", "たべる"],
      ["買い物", "かいもの"],
      ["日本語", "にほんご"],
      ["取り扱い", "とりあつかい"],
      ["見せる", "ミセル"]
    ] as const) {
      expect(stripRuby(toRubyMarkdown(surface, reading)).text).toBe(surface);
    }
  });
});

describe("toRubyHtml", () => {
  it("emits ruby elements per kanji run", () => {
    expect(toRubyHtml("食べる", "たべる")).toBe(
      "<ruby>食<rt>た</rt></ruby>べる"
    );
    expect(toRubyHtml("買い物", "かいもの")).toBe(
      "<ruby>買<rt>か</rt></ruby>い<ruby>物<rt>もの</rt></ruby>"
    );
  });

  it("falls back to one element around the whole word", () => {
    expect(toRubyHtml("食べる", "のむ")).toBe(
      "<ruby>食べる<rt>のむ</rt></ruby>"
    );
  });
});
