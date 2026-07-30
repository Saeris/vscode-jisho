import { describe, expect, it } from "vitest";
import { copyVariants } from "../CopyAsMenu";

/**
 * The menu's markup is a React Aria collection, which needs browser layout APIs jsdom does not
 * implement — the same limitation SearchResults.spec records for ListBox. The interaction (open the
 * menu, pick an entry, text reaches the clipboard) is covered end-to-end by smoke.e2e's "copy as:
 * furigana markdown reaches the system clipboard". What is worth pinning here is the decision the
 * component makes before any of that: which shapes exist, and what each one actually copies.
 */
describe("copyVariants", () => {
  it("offers every shape an author needs for a kanji word", () => {
    // WHY: the point of the menu is that hand-writing ruby markup is tedious and error-prone. The
    // ruby variants annotate ONLY the kanji — {食|た}べる, never {食べる|たべる} — which is what makes
    // them worth a menu entry rather than something the user could reasonably type.
    const variants = copyVariants("食べる", "たべる");
    expect(variants.map((v) => v.id)).toEqual([
      "word",
      "reading",
      "romaji",
      "ruby-md",
      "ruby-html"
    ]);
    expect(variants.map((v) => v.value)).toEqual([
      "食べる",
      "たべる",
      "taberu",
      "{食|た}べる",
      "<ruby>食<rt>た</rt></ruby>べる"
    ]);
  });

  it("omits the ruby shapes for a kana-only word", () => {
    // WHY: there is nothing to annotate, so a ruby entry would repeat the word back — an option that
    // looks like it does something and does not.
    expect(copyVariants("ひらがな", "ひらがな").map((v) => v.id)).toEqual([
      "word",
      "reading",
      "romaji"
    ]);
  });

  it("offers only the word when the reading is unknown", () => {
    // WHY: reading, romaji and both ruby forms all derive from the reading. With none, every other
    // entry would be empty or a copy of the word.
    expect(copyVariants("ABC", "").map((v) => v.id)).toEqual(["word"]);
  });

  it("annotates a word with okurigana between kanji runs", () => {
    // WHY: 買い物 is the case a naive whole-word annotation gets wrong — the reading has to split
    // around the い, not wrap the lot.
    const md = copyVariants("買い物", "かいもの").find(
      (v) => v.id === "ruby-md"
    );
    expect(md?.value).toBe("{買|か}い{物|もの}");
  });

  it("falls back to whole-word ruby when the reading cannot be aligned", () => {
    // WHY: a coarse-but-correct annotation beats dropping the reading. alignReading returns null
    // here, and the variant still has to produce something copyable.
    const md = copyVariants("食べる", "のむ").find((v) => v.id === "ruby-md");
    expect(md?.value).toBe("{食べる|のむ}");
  });
});
