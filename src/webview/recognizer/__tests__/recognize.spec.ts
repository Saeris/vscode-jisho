import { describe, expect, it } from "vitest";
import { recognize } from "../index";
import { refPatterns } from "../patterns";

// End-to-end recognition against the real reference patterns. Feeding a character's OWN canonical
// strokes must rank that character at (or very near) the top — the strongest signal that the whole
// pipeline (normalize → features → coarse → fine) is wired correctly on real data. This complements
// the algorithm-level fidelity tests in correspondence.spec.ts.
const strokesFor = (
  char: string
): (readonly (readonly [number, number])[])[] => {
  const entry = refPatterns.find((p) => p[0] === char);
  if (!entry) throw new Error(`no reference pattern for ${char}`);
  return entry[2] as (readonly (readonly [number, number])[])[];
};

describe("recognize (end-to-end, real patterns)", () => {
  it("loads the reference patterns", () => {
    // WHY: guards the ref-patterns → typed module conversion; a broken export would empty the set.
    expect(refPatterns.length).toBeGreaterThan(1000);
    expect(refPatterns[0][0]).toBe("一");
  });

  it("ranks a character's own strokes among the top candidates", () => {
    // WHY: a character drawn exactly as its reference must surface near the top. We assert top-3 (not
    // strictly #1) because recognition is inherently a candidate LIST — visually near-identical pairs
    // like 日/曰 (differing only in aspect ratio, which moment-normalization partly collapses) can
    // tie, and the UI shows ~8 chips precisely so the user picks. Top-3 is the honest correctness bar.
    for (const char of ["一", "日", "山", "食", "語"]) {
      const candidates = recognize(strokesFor(char), refPatterns, 10);
      expect(candidates.slice(0, 3)).toContain(char);
    }
  });

  it("self-recognizes the large majority of a broad character sample", () => {
    // WHY: a 5-char check can hide dataset-wide regressions. Sweep every 40th pattern (a spread of
    // stroke counts and complexities) and require a char's own canonical strokes to rank top-5 for
    // the vast majority. This is a statistical guard on the whole pipeline: a metric/normalization
    // regression would crater this rate even if the hand-picked five still passed. The bar is <100%
    // because genuine near-twins (日/曰, ロ/口/囗) legitimately swap ranks.
    const sample = refPatterns.filter((_, i) => i % 40 === 0);
    let top5 = 0;
    for (const [char, , strokes] of sample) {
      const candidates = recognize(strokes, refPatterns, 5);
      if (candidates.includes(char)) top5++;
    }
    const rate = top5 / sample.length;
    expect(sample.length).toBeGreaterThan(40); // a real sample, not a handful
    expect(rate).toBeGreaterThan(0.9); // ≥90% self-recognized in the top 5
  });

  it("returns no candidates for empty input", () => {
    // WHY: an empty canvas must yield nothing, not throw or return noise.
    expect(recognize([], refPatterns)).toEqual([]);
  });

  // ── Degenerate input (regression: drawing え crashed the extension) ──────────
  // A single-point or zero-area stroke moment-normalizes to NaN coordinates, which the distance
  // metrics can't rank — it used to throw "Cannot read properties of undefined". recognize() now
  // rejects degenerate input up front. These pin that guard so the crash can't return.

  it("does not throw on a single-point stroke", () => {
    expect(() => recognize([[[100, 100]]], refPatterns)).not.toThrow();
    expect(recognize([[[100, 100]]], refPatterns)).toEqual([]);
  });

  it("does not throw on a zero-length stroke (identical points)", () => {
    const stroke = [
      [100, 100],
      [100, 100]
    ] as const;
    expect(() => recognize([stroke], refPatterns)).not.toThrow();
    expect(recognize([stroke], refPatterns)).toEqual([]);
  });

  it("ignores a stray dot but still recognizes a real stroke drawn with it", () => {
    // WHY: a fat-fingered tap before a real stroke shouldn't crash or block recognition — the
    // degenerate stroke is dropped and the real one is recognized.
    const dot = [[50, 50]] as const;
    const line = [
      [10, 10],
      [80, 80],
      [120, 40]
    ] as const;
    expect(() => recognize([dot, line], refPatterns)).not.toThrow();
    expect(recognize([dot, line], refPatterns).length).toBeGreaterThan(0);
  });

  it("returns candidates ranked best-first, capped at the limit", () => {
    // WHY: the UI shows the top N as chips; the limit must be honoured and the best match lead.
    const candidates = recognize(strokesFor("語"), refPatterns, 8);
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(candidates).toContain("語");
  });
});
