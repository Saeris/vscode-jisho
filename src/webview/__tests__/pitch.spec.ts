import { describe, expect, it } from "vitest";
import { pitchContour, toMoras } from "../pitch";

describe("toMoras", () => {
  it("keeps plain kana as one mora each", () => {
    // WHY: the contour draws one cell per mora; a wrong split misaligns the overline. たべる = 3.
    expect(toMoras("たべる")).toEqual(["た", "べ", "る"]);
  });

  it("fuses yōon (small ゃゅょ) onto the preceding mora", () => {
    // WHY: きょ is ONE mora, not two — pitch positions count moras, so 東京 とうきょう is 4 moras
    // (と・う・きょ・う), not 5. Mis-counting shifts the downstep to the wrong syllable.
    expect(toMoras("きょう")).toEqual(["きょ", "う"]);
    expect(toMoras("とうきょう")).toEqual(["と", "う", "きょ", "う"]);
  });

  it("treats small っ (sokuon) and ー as their own moras", () => {
    // WHY: unlike yōon, the sokuon and long-vowel mark each occupy a full mora beat.
    expect(toMoras("がっこう")).toEqual(["が", "っ", "こ", "う"]);
    expect(toMoras("コーヒー")).toEqual(["コ", "ー", "ヒ", "ー"]);
  });
});

describe("pitchContour", () => {
  it("renders heiban (0) as low-then-high with no drop", () => {
    // WHY: 水 みず [0] rises and stays high (into the particle); no mora carries a drop.
    const c = pitchContour("みず", 0);
    expect(c.map((m) => m.high)).toEqual([false, true]);
    expect(c.some((m) => m.drop)).toBe(false);
  });

  it("renders atamadaka (1) as high-first with an immediate drop", () => {
    // WHY: accent 1 means the first mora is high and it drops right after — the drop sits on mora 1.
    const c = pitchContour("いち", 1);
    expect(c.map((m) => m.high)).toEqual([true, false]);
    expect(c[0].drop).toBe(true);
  });

  it("renders nakadaka (N≥2, drop mid-word) with the drop after mora N", () => {
    // WHY: 食べる たべる [2] is た(low) べ(high) る(low) — moras 2..2 high, then it drops after
    // mora 2, so mora 3 is low again. This is the exact Shirabe contour the screenshots show;
    // getting the drop position (and the return to low after it) right is the whole point.
    const c = pitchContour("たべる", 2);
    expect(c.map((m) => m.high)).toEqual([false, true, false]);
    expect(c[1].drop).toBe(true);
    expect(c[0].drop).toBe(false);
    expect(c[2].drop).toBe(false);
  });

  it("renders odaka (drop on the final mora) as low-then-high with a trailing drop", () => {
    // WHY: 男 おとこ [3] is low-high-high with the drop on the LAST mora (こ) — you only see the
    // drop when a particle follows. Distinct from nakadaka: no in-word return to low.
    const c = pitchContour("おとこ", 3);
    expect(c.map((m) => m.high)).toEqual([false, true, true]);
    expect(c[2].drop).toBe(true);
  });

  it("counts moras, not characters, when placing the drop", () => {
    // WHY: with a yōon, a character-based index would drop on the wrong glyph. For a 3-mora reading
    // きょうと-like split, the accent mora must map through the fused mora, not the raw char.
    const c = pitchContour("きょう", 1);
    // 2 moras: きょ (high, drop), う (low).
    expect(c).toHaveLength(2);
    expect(c[0].mora).toBe("きょ");
    expect(c[0].drop).toBe(true);
    expect(c[1].high).toBe(false);
  });
});
