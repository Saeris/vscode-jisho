import { describe, expect, it } from "vitest";
import { addSpacingToLine, removeSpacingFromLine } from "../spacing";

// These run against the REAL tokenizer (Lindera + IPADIC): spacing quality IS segmentation
// quality, so mocking it would test nothing.

describe("addSpacingToLine (分かち書き)", () => {
  it("spaces word groups, keeping conjugations whole and particles separate", async () => {
    // WHY: this is the user's manual practice automated — boundaries a learner needs marked,
    // without shredding conjugated forms into morpheme confetti.
    await expect(addSpacingToLine("写真を見せました")).resolves.toBe(
      "写真 を 見せました"
    );
  });

  it("keeps ruby-marked words atomic and spaces before their braces", async () => {
    // WHY: the user's documents mark furigana as {食|た}べる — an insertion inside the braces
    // would corrupt the markup; the space belongs before the `{`.
    await expect(
      addSpacingToLine("{写真|しゃしん}を{見|み}せました")
    ).resolves.toBe("{写真|しゃしん} を {見|み}せました");
  });

  it("leaves English text and pure-kana runs untouched", async () => {
    // WHY: pure-kana runs tokenize into garbage (no script transitions) — wrong spacing teaches
    // wrong boundaries, so those runs pass through unchanged.
    const line = "I said これはペンです to him";
    await expect(addSpacingToLine(line)).resolves.toBe(line);
  });
});

describe("removeSpacingFromLine", () => {
  it("removes spaces between Japanese, keeping English boundaries", () => {
    // WHY: the inverse transform — restore native-style text — must not glue "ate 食" together.
    expect(removeSpacingFromLine("写真 を 見せました")).toBe(
      "写真を見せました"
    );
    expect(removeSpacingFromLine("I ate 食べました today")).toBe(
      "I ate 食べました today"
    );
  });

  it("removes spaces at ruby-group boundaries and ideographic spaces", () => {
    expect(removeSpacingFromLine("{写真|しゃしん} を {見|み}せました")).toBe(
      "{写真|しゃしん}を{見|み}せました"
    );
    expect(removeSpacingFromLine("写真　を　見せました")).toBe(
      "写真を見せました"
    );
  });

  it("round-trips with addSpacingToLine", async () => {
    // WHY: the whole point of a formatter pair — spacing for study, unspacing for publishing —
    // is that neither direction loses information.
    const original = "{写真|しゃしん}を{見|み}せました";
    const spaced = await addSpacingToLine(original);
    expect(removeSpacingFromLine(spaced)).toBe(original);
  });
});
