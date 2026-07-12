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

  it("returns no candidates for empty input", () => {
    // WHY: an empty canvas must yield nothing, not throw or return noise.
    expect(recognize([], refPatterns)).toEqual([]);
  });

  it("returns candidates ranked best-first, capped at the limit", () => {
    // WHY: the UI shows the top N as chips; the limit must be honoured and the best match lead.
    const candidates = recognize(strokesFor("語"), refPatterns, 8);
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(candidates).toContain("語");
  });
});
