import { describe, expect, it } from "vitest";
import {
  glossTag,
  posPill,
  wordHoverMarkdown,
  type WordHover
} from "../hoverHtml";

const base: WordHover = {
  headword: "注意",
  reading: "ちゅうい",
  breakdown: null,
  senses: [
    {
      partOfSpeech: [
        { code: "n", description: "noun" },
        { code: "vs", description: "suru verb" }
      ],
      glosses: ["attention", "notice", "heed", "care"],
      sentences: [{ ja: "注意してください。", en: "Please be careful." }]
    }
  ]
};

describe("posPill", () => {
  it("shows a compact Japanese label with the English in the tooltip", () => {
    // The whole point of the pill: a learner reads 名詞 faster than "noun", and it is shorter, but
    // the English has to stay reachable — so it goes in the title rather than being discarded.
    const pill = posPill("n", "noun");
    expect(pill).toContain(">名詞<");
    expect(pill).toContain('title="noun"');
    expect(pill).toMatch(/^<kbd/);
  });

  it("collapses the many suru-verb codes to one label", () => {
    // vs / vs-s / vs-i all mean "する verb" to a reader; showing three different labels would be
    // noise. They share a pill label but keep their own English descriptions in the tooltip.
    for (const code of ["vs", "vs-s", "vs-i"]) {
      expect(posPill(code, "x")).toContain(">する動詞<");
    }
  });

  it("falls back to the English label for an unmapped code", () => {
    // An unknown POS code must degrade to something readable, not vanish or render an empty pill —
    // JMdict has a long tail of rare codes we have not mapped.
    const pill = posPill("zzz", "some rare pos");
    expect(pill).toContain(">some rare pos<");
  });

  it("escapes a description so a stray quote cannot break the hover", () => {
    // This is the load-bearing test. The renderer strips style/class but an unescaped " in a title
    // would break OUT of the attribute and corrupt the markup — and a malformed fragment makes the
    // ENTIRE hover fail to render (measured, not theorized). Descriptions come from JMdict data, so
    // this is real input, not a hypothetical.
    const pill = posPill("x", 'aux. verb "to be"; copula');
    expect(pill).not.toMatch(/title="[^"]*"[^>]*"/); // no second unescaped quote inside the tag
    expect(pill).toContain("&quot;");
  });
});

describe("glossTag", () => {
  it("wraps visible text with a title tooltip", () => {
    const tag = glossTag("〜します", "Non-past (polite)");
    expect(tag).toBe('<ins title="Non-past (polite)">〜します</ins>');
  });

  it("escapes the title", () => {
    expect(glossTag("x", 'a & b < c > "d"')).toContain(
      'title="a &amp; b &lt; c &gt; &quot;d&quot;"'
    );
  });
});

describe("wordHoverMarkdown", () => {
  it("leads with a ruby heading so the reading renders as legible furigana", () => {
    // The layout's core decision: the headword is an h1 with <ruby>, not body text with inline
    // <rt>. A live probe measured body <rt> at 7px (unreadable); heading-scale furigana is the fix.
    const md = wordHoverMarkdown(base);
    expect(md).toMatch(/^# <ruby>注意<rt>ちゅうい<\/rt><\/ruby>/);
  });

  it("puts a thematic break under the headword", () => {
    // The visible rule separating headword from body. An inline <hr> collapsed in testing; the
    // markdown `---` (blank-line delimited) is what actually renders a rule.
    expect(wordHoverMarkdown(base)).toContain("\n\n---\n\n");
  });

  it("renders POS as pills, capping glosses so the line stays scannable", () => {
    const md = wordHoverMarkdown(base);
    expect(md).toContain("<kbd");
    expect(md).toContain("名詞");
    expect(md).toContain("する動詞");
    // Four glosses in the data, three shown — a hover is a glance, not the full entry. Assert on
    // the joined gloss line exactly, since "care" also occurs inside the example ("careful").
    expect(md).toContain("attention; notice; heed");
    expect(md).not.toContain("; care");
  });

  it("shows one example as a blockquote with a dimmed translation", () => {
    const md = wordHoverMarkdown(base);
    expect(md).toContain("> 注意してください。");
    expect(md).toContain("<small>*Please be careful.*</small>");
  });

  it("shows the conjugation breakdown as an h3 only when present", () => {
    expect(wordHoverMarkdown(base)).not.toContain("###");
    const conjugated = wordHoverMarkdown({
      ...base,
      breakdown: "注意します = 注意 + 〜します"
    });
    expect(conjugated).toContain("### 注意します");
  });

  it("omits ruby for a kana-only word", () => {
    // A kana headword has no kanji to annotate; wrapping it in <ruby> would duplicate the reading.
    const kana = wordHoverMarkdown({
      ...base,
      headword: "から",
      reading: "から"
    });
    expect(kana).not.toContain("<ruby>");
    expect(kana).toContain("# から");
  });

  it("survives an entry with no senses without emitting a dangling body", () => {
    // getWord can return an entry whose senses array is empty; the renderer must still produce a
    // valid heading rather than crash on senses[0]. This is the case the type system hides.
    const md = wordHoverMarkdown({ ...base, senses: [] });
    expect(md).toContain("# <ruby>注意");
    expect(md).not.toContain("<kbd");
  });
});
