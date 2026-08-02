import { describe, expect, it } from "vitest";
import { posPillLabel, usageLabel } from "../posTags";

/**
 * The ENGLISH half of the pill vocabulary, added when English became the default label style.
 * The Japanese half is exercised through the hover in `hoverHtml.spec.ts`, which is the surface it
 * originally shipped for.
 */
describe("posPillLabel", () => {
  it("replaces JMdict's editor-facing descriptions with pill-sized English", () => {
    // WHY the curated table exists: JMdict's descriptions are annotated for a dictionary editor,
    // not a chip. `n` is the most common tag in the whole dictionary (27,384 senses) and its
    // description is 28 characters of which 18 are parentheses.
    expect(posPillLabel("n", "noun (common) (futsuumeishi)", "english")).toBe(
      "noun"
    );
    expect(
      posPillLabel(
        "adj-no",
        "nouns which may take the genitive case particle 'no'",
        "english"
      )
    ).toBe("の adjective");
  });

  it("derives the regular verb families from the code's structure", () => {
    // WHY: the same bug the Japanese table had (v5r-i fell through a hand-listed table). JMdict has
    // a dozen v5* codes and adds more; matching the FAMILY means a newly-seen code still resolves
    // rather than dumping a sentence into a pill.
    for (const code of ["v5r-i", "v5aru", "v5u-s", "v5k-s", "v5b"]) {
      expect(posPillLabel(code, "some long description", "english")).toBe(
        "godan verb"
      );
    }
    expect(posPillLabel("v1-s", "Ichidan verb - kureru", "english")).toBe(
      "ichidan verb"
    );
    expect(posPillLabel("vs-i", "suru verb - irregular", "english")).toBe(
      "suru verb"
    );
  });

  it("falls back across styles before falling back to the description", () => {
    // WHY: the two tables are not required to cover the same codes. A code with only one curated
    // label still reads better as that label than as JMdict's full sentence, so the miss cascades
    // to the other language first and only then gives up.
    expect(
      posPillLabel("exp", "expressions (phrases, clauses, etc.)", "japanese")
    ).toBe("表現");
    // A code in neither table keeps the description, so nothing is ever silently dropped.
    expect(posPillLabel("unk-code", "a description", "english")).toBe(
      "a description"
    );
    expect(posPillLabel("unk-code", "a description", "japanese")).toBe(
      "a description"
    );
  });
});

describe("usageLabel", () => {
  it("shortens the few unwieldy usage tags and leaves the rest alone", () => {
    // WHY: measured over the shipped dictionary, the misc vocabulary is already pill-sized almost
    // everywhere. `uk` is the outlier — the most common misc tag (2,360 senses) with the longest
    // description — which is what made this look like a general problem needing a general rule.
    expect(usageLabel("uk", "word usually written using kana alone")).toBe(
      "kana"
    );
    expect(usageLabel("col", "colloquial")).toBe("colloquial");
    expect(usageLabel("comp", "computing")).toBe("computing");
  });

  it("switches usage tags with the same setting as parts of speech", () => {
    // WHY: a mixed row ("noun 尊敬語") would read worse than either mode, so the setting has to
    // move BOTH vocabularies. Where the Japanese term is what a learner would actually meet
    // (尊敬語, 擬音語) it is used; `uk`/`uK` have no Japanese grammatical term, so they stay
    // recognisable in brackets rather than inventing one.
    expect(
      usageLabel(
        "hon",
        "honorific or respectful (sonkeigo) language",
        "japanese"
      )
    ).toBe("尊敬語");
    expect(
      usageLabel("on-mim", "onomatopoeic or mimetic word", "japanese")
    ).toBe("擬音語");
    expect(
      usageLabel("uk", "word usually written using kana alone", "japanese")
    ).toBe("「kana」");
    // Untabled tags keep the English description in Japanese mode rather than inventing a
    // translation the dictionary does not carry.
    expect(usageLabel("col", "colloquial", "japanese")).toBe("colloquial");
  });
});
