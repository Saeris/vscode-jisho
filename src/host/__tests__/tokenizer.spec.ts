import { describe, expect, it } from "vitest";
import { contentSegmentCount, segment } from "../tokenizer";

// These run against the real Lindera WASM (loaded synchronously at require in the node env).
describe("tokenizer.segment", () => {
  it("segments a multi-word sentence into content units and particles", async () => {
    // WHY: this is the headline feature — 日本語を勉強します must break into the searchable
    // content words (日本語, 勉強する) plus the particle を, so the breakdown bar can offer each.
    const segments = await segment("日本語を勉強します");
    const surfaces = segments.map((s) => s.surface);
    expect(surfaces).toContain("日本語");
    expect(surfaces).toContain("を");
    // 勉強 + します coalesces into one verb segment (サ変 compound).
    const benkyou = segments.find((s) => s.surface.startsWith("勉強"));
    expect(benkyou?.lemma).toBe("勉強");
    expect(benkyou?.pos).toBe("verb");
    const wo = segments.find((s) => s.surface === "を");
    expect(wo?.pos).toBe("particle");
  });

  it("coalesces verb + auxiliary chains and exposes the dictionary form", async () => {
    // WHY: a segment's lemma is what tapping it searches; conjugation must resolve to the base
    // form. 食べました → one 食べる verb segment (not 食べ + まし + た).
    const segments = await segment("食べました");
    expect(segments).toHaveLength(1);
    expect(segments[0].lemma).toBe("食べる");
    expect(segments[0].pos).toBe("verb");
  });

  it("resolves adjective inflections to their dictionary form", async () => {
    const segments = await segment("たかくない");
    const adj = segments.find((s) => s.pos === "adjective");
    expect(adj?.lemma).toBe("たかい");
  });

  it("counts only content segments for the breakdown decision", async () => {
    // WHY: a single word (or word + particle) shouldn't trigger a breakdown UI; only genuinely
    // multi-content-word queries should.
    expect(contentSegmentCount(await segment("食べる"))).toBe(1);
    expect(
      contentSegmentCount(await segment("日本語を勉強します"))
    ).toBeGreaterThan(1);
  });
});
