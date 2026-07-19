import { describe, expect, it } from "vitest";
import { addFuriganaToLine, removeFuriganaFromLine } from "../furigana";
import { segment } from "../tokenizer";

// Real tokenizer (Lindera + IPADIC), like spacing.spec.ts: annotation quality IS segmentation and
// reading quality, so a mock would prove nothing.

describe("tokenizer readings", () => {
  it("grows a folded segment's reading with its surface", async () => {
    // WHY: the fold used to append only the surface, so 見せました reported the head's ミセ. Every
    // conjugated verb then failed to align (reading shorter than the word) and lost its furigana.
    const [seg] = await segment("見せました");
    expect(seg.surface).toBe("見せました");
    expect(seg.reading).toBe("ミセマシタ");
    expect(seg.parts.map((part) => part.reading).join("")).toBe("ミセマシタ");
  });
});

describe("addFuriganaToLine", () => {
  it("annotates only the kanji, keeping okurigana outside the ruby", async () => {
    await expect(addFuriganaToLine("写真を見せました")).resolves.toBe(
      "{写真|しゃしん}を{見|み}せました"
    );
  });

  it("annotates a conjugation as one word", async () => {
    // WHY: groups, not morphemes — {食|た}べたくなかった reads as one word with one reading,
    // rather than annotating every auxiliary fragment separately.
    await expect(addFuriganaToLine("食べたくなかった")).resolves.toBe(
      "{食|た}べたくなかった"
    );
  });

  it("leaves already-annotated words alone", async () => {
    // WHY: running the command twice (or on a partly-annotated document — the user's real files)
    // must not nest braces and corrupt the markup.
    const once = await addFuriganaToLine("写真を見せました");
    await expect(addFuriganaToLine(once)).resolves.toBe(once);
  });

  it("leaves English and pure-kana text untouched", async () => {
    const line = "I said これはペンです to him";
    await expect(addFuriganaToLine(line)).resolves.toBe(line);
  });
});

describe("removeFuriganaFromLine", () => {
  it("strips ruby back to the base text", () => {
    expect(removeFuriganaFromLine("{写真|しゃしん}を{見|み}せました")).toBe(
      "写真を見せました"
    );
  });

  it("round-trips with addFuriganaToLine", async () => {
    // WHY: annotate for study, strip for publishing — neither direction may lose text.
    const original = "写真を見せました";
    const annotated = await addFuriganaToLine(original);
    expect(removeFuriganaFromLine(annotated)).toBe(original);
  });
});
