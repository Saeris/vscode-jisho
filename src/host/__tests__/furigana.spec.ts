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

  it("annotates kanji that sit next to markdown emphasis", async () => {
    // WHY: BACKLOG #52, and it failed SILENTLY — the command reported success and the kanji simply
    // had no reading. `stripRuby` dropped the markers, so a group's source span could CONTAIN one
    // (`重要です` maps to source 1..6 of `*重要*です`, which spans the closing `*`). The
    // already-annotated guard compares span width against surface length, saw 5 vs 4, and skipped
    // the word rather than emit an edit that would have deleted the marker. Both readings of that
    // situation are bad; the fix is to not drop the markers on a REWRITE path at all.
    await expect(addFuriganaToLine("*重要*です")).resolves.toBe(
      "*{重要|じゅうよう}*です"
    );
    await expect(addFuriganaToLine("**重要**です")).resolves.toBe(
      "**{重要|じゅうよう}**です"
    );
    await expect(addFuriganaToLine("重要*です*")).resolves.toBe(
      "{重要|じゅうよう}*です*"
    );
    // It also FIXES coverage that was missing before: 遅 inside the emphasis never got a reading.
    await expect(addFuriganaToLine("彼に*遅れない*ように")).resolves.toBe(
      "{彼|かれ}に*{遅|おく}れない*ように"
    );
  });

  it("still refuses to re-annotate text that already has ruby", async () => {
    // WHY: the guard that caused #52 is load-bearing for its actual purpose — re-wrapping would
    // nest braces. Relaxing the emphasis case must not relax this one.
    await expect(addFuriganaToLine("{食|た}べる")).resolves.toBe("{食|た}べる");
  });

  it("leaves markdown emphasis alone", () => {
    // WHY: this shipped broken, and the round-trip test above could not catch it — its input has no
    // emphasis to lose. The command was built on `stripRuby`, which drops `*`/`**`/`_`/`` ` ``/`==`/`~~`
    // ON PURPOSE so a wrapped span reads as ONE Japanese run for highlighting. Correct for analysis,
    // data loss for a command that rewrites the user's document: "Remove furigana" on
    // `これは**重要**です` returned `これは重要です` and took the bold with it.
    expect(removeFuriganaFromLine("これは**重要**です")).toBe(
      "これは**重要**です"
    );
    expect(removeFuriganaFromLine("彼に*遅れない*ように")).toBe(
      "彼に*遅れない*ように"
    );
    expect(removeFuriganaFromLine("`コード`と_強調_")).toBe("`コード`と_強調_");
    expect(removeFuriganaFromLine("~~取り消し~~ と ==強調==")).toBe(
      "~~取り消し~~ と ==強調=="
    );
    // The ruby still goes, including when emphasis wraps it.
    expect(removeFuriganaFromLine("*{食|た}べる*")).toBe("*食べる*");
  });

  it("round-trips emphasised text byte-for-byte", async () => {
    // WHY: the two features have to compose, and the assertion has to be against the ORIGINAL. Written
    // first as `strip(add(x)) === strip(x)`, it passed on the broken implementation — both sides lost
    // the emphasis, so the loss cancelled and the test proved nothing.
    const original = "これは**重要**な写真です";
    expect(removeFuriganaFromLine(await addFuriganaToLine(original))).toBe(
      original
    );
  });
});
