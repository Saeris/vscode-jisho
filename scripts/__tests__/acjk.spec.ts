import { describe, expect, it } from "vitest";
import { parseAcjk, radicalPosition } from "../acjk";

describe("acjk decomposition parsing", () => {
  it("maps components to consecutive stroke ranges and marks the radical", () => {
    // WHY: the acjk field is in DRAWING order, so ranges are cumulative — 原's 10 strokes come
    // first, making 頁 strokes 11–19. Getting this wrong highlights the wrong half of the kanji.
    expect(parseAcjk("願", "願⿰原10頁.9")).toEqual({
      strokeTotal: 19,
      parts: [
        { literal: "原", radical: false, ranges: [{ start: 1, end: 10 }] },
        { literal: "頁", radical: true, ranges: [{ start: 11, end: 19 }] }
      ]
    });
  });

  it("merges split components (:) into one part with multiple ranges", () => {
    // WHY: an enclosure like 国's 囗 is drawn in two runs (strokes 1–2, then 8 closes the box).
    // Both runs are the SAME part — hovering 囗 must highlight all three strokes, and there must be
    // one hit rect, not two overlapping ones.
    expect(parseAcjk("国", "国⿴囗.:2玉5囗.:1")).toEqual({
      strokeTotal: 8,
      parts: [
        {
          literal: "囗",
          radical: true,
          ranges: [
            { start: 1, end: 2 },
            { start: 8, end: 8 }
          ]
        },
        { literal: "玉", radical: false, ranges: [{ start: 3, end: 7 }] }
      ]
    });
  });

  it("keeps repeated components separate when not split-marked", () => {
    // WHY: 林-style repetition is two INSTANCES of the same shape, not one split shape — each gets
    // its own hit rect. Only ':' signals continuation.
    const result = parseAcjk("⺀", "⺀.⿱丶1丶1");
    expect(result?.parts).toHaveLength(2);
    expect(result?.parts.every((p) => !p.radical)).toBe(true);
  });

  it("returns null when there is nothing to tell apart or the field is malformed", () => {
    // WHY: a single-part decomposition would put one rect over the whole character — a hit target
    // that adds nothing. Malformed input must not produce garbage ranges.
    expect(parseAcjk("丶", "丶丶1")).toBeNull();
    expect(parseAcjk("⺄", "⺄.1")).toBeNull();
    expect(parseAcjk("近", "斤4⻌.3")).toBeNull();
  });
});

describe("radicalPosition", () => {
  it("classifies the textbook's own examples", () => {
    // WHY: BACKLOG #30 validated this mapping against the Kanji Look & Learn examples (18/19) and
    // cross-checked it against KanjiVG's independent kvg:position data. These are the real acjk
    // strings from that validation — the seven categories are what the picker filter will offer,
    // so a wrong classification sends a learner to the wrong shelf.
    expect(radicalPosition("体", "体⿰亻.2本5")).toBe("hen");
    expect(radicalPosition("語", "語⿰言.7吾7")).toBe("hen");
    expect(radicalPosition("頭", "頭⿰豆7頁.9")).toBe("tsukuri");
    expect(radicalPosition("字", "字⿱宀3子.3")).toBe("ashi");
    expect(radicalPosition("広", "広⿸广.3厶2")).toBe("tare");
    expect(radicalPosition("道", "道⿺首9⻌.3")).toBe("nyo");
    expect(radicalPosition("近", "近⿺斤4⻌.3")).toBe("nyo");
  });

  it("treats a split enclosure as kamae", () => {
    // WHY: 国's 囗 is drawn in two runs, so its segment carries BOTH the radical and split markers
    // (`囗.:2`) AND appears a second time later in the field. A parser that stops at the first
    // marker, or that assumes one segment per component, misreads the rest and 国 drops out of the
    // vote. Note spec 04 quotes this string truncated as `国⿴囗.:2玉5`; the real entry is below.
    expect(radicalPosition("国", "国⿴囗.:2玉5囗.:1")).toBe("kamae");
  });

  it("returns null when the character IS its own radical", () => {
    // WHY: the ~6% that don't classify are a real distinction, not a gap. 見 is Kangxi radical
    // #147, so a leading '.' marks the whole character — there is no sub-component to place, and
    // guessing one would put 見 under a category the textbook files it in for a different reason.
    expect(radicalPosition("見", "見.⿱目5儿2")).toBeNull();
  });

  it("returns null rather than guessing at an unmapped layout", () => {
    // WHY: the validated table covers seven IDCs. Triples (⿲ ⿳) are not among them, and a guess
    // would silently pollute the per-radical majority vote with an unvalidated category.
    expect(radicalPosition("㣎", "㣎⿳白5小3彡.3")).toBeNull();
  });

  it("returns null on input it cannot parse", () => {
    expect(radicalPosition("体", "別⿰亻.2本5")).toBeNull();
    expect(radicalPosition("体", "体⿰亻.本")).toBeNull();
  });
});
