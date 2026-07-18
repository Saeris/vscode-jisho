import { describe, expect, it } from "vitest";
import {
  describeGroup,
  groupSegments,
  japaneseRunAt,
  japaneseRuns,
  stripRuby,
  toStrippedIndex,
  wordAt
} from "../hover";

describe("japaneseRunAt", () => {
  it("finds the contiguous Japanese run around the cursor in mixed text", () => {
    // WHY: hovers fire on every mouse pause in any file — the run finder is the cheap gate that
    // keeps English text from ever reaching the tokenizer or the database.
    const line = "I ate 食べました yesterday";
    expect(japaneseRunAt(line, 8)).toEqual({ text: "食べました", start: 6 });
    expect(japaneseRunAt(line, 2)).toBeNull();
    expect(japaneseRunAt(line, 20)).toBeNull();
  });

  it("counts a cursor just past the run's last character as inside it", () => {
    // WHY: hovering the tail edge of a word is common; treating it as a miss makes the hover
    // flicker at word boundaries.
    const line = "食べる!";
    expect(japaneseRunAt(line, 3)).toEqual({ text: "食べる", start: 0 });
  });

  it("keeps ー and 々 inside runs", () => {
    // WHY: these aren't kana but occur mid-word (コーヒー, 人々) — splitting on them would hover
    // half a word.
    expect(japaneseRunAt("コーヒーを飲む", 2)).toEqual({
      text: "コーヒーを飲む",
      start: 0
    });
    expect(japaneseRunAt("人々が", 1)).toEqual({ text: "人々が", start: 0 });
  });
});

describe("wordAt", () => {
  const segments = [
    { surface: "日本語", lemma: "日本語" },
    { surface: "を", lemma: "を" },
    { surface: "食べました", lemma: "食べる" }
  ];

  it("picks the segment the cursor offset falls in, with its start offset", () => {
    // WHY: the hover must describe the word UNDER the cursor, not the first word of the run —
    // and the start offset is what highlights the right span in the editor.
    expect(wordAt(segments, 0)).toEqual({ segment: segments[0], start: 0 });
    expect(wordAt(segments, 3)).toEqual({ segment: segments[1], start: 3 });
    expect(wordAt(segments, 5)).toEqual({ segment: segments[2], start: 4 });
    expect(wordAt(segments, 99)).toBeNull();
  });
});

describe("stripRuby", () => {
  it("passes plain lines through with identity mapping", () => {
    const s = stripRuby("I ate 食べました");
    expect(s.text).toBe("I ate 食べました");
    expect(s.starts[6]).toBe(6);
    expect(s.ends[6]).toBe(7);
  });

  it("reduces mirrordown ruby to its base text so the run stays whole", () => {
    // WHY (user's sample docs): {食|た}べました must hover as 食べました — the braces otherwise
    // split the Japanese run and the hover sees fragments by construction.
    const s = stripRuby("{食|た}べました。");
    expect(s.text).toBe("食べました。");
  });

  it("widens group-edge spans so highlights cover the whole {…|…} construct", () => {
    const line = "{食|た}べる";
    const s = stripRuby(line);
    // 食 is stripped char 0: its unit starts at "{" and ends after "}".
    expect(s.starts[0]).toBe(0);
    expect(s.ends[0]).toBe("{食|た}".length);
    // べ follows the group, mapped 1:1.
    expect(s.starts[1]).toBe("{食|た}".length);
  });

  it("maps cursors on the reading or braces into the base character", () => {
    // WHY: hovering the annotation half of {漢字|かんじ} should describe 漢字, not miss.
    const s = stripRuby("{漢字|かんじ}を書く");
    const onReading = toStrippedIndex(s, "{漢字|か".length);
    expect(s.text[onReading]).toBe("字");
  });
});

describe("groupSegments", () => {
  it("attaches auxiliaries to the verb so a conjugation is one unit", () => {
    // WHY (user report): hovering たく in 食べたくなかった described たい — the fragment under the
    // cursor — instead of the word. Grouped, any offset in the conjugation resolves 食べる.
    const groups = groupSegments([
      { surface: "食べ", lemma: "食べる", pos: "verb" },
      { surface: "たく", lemma: "たい", pos: "auxiliary" },
      { surface: "なかっ", lemma: "ない", pos: "auxiliary" },
      { surface: "た", lemma: "た", pos: "auxiliary" }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].surface).toBe("食べたくなかった");
    expect(groups[0].lemma).toBe("食べる");
    expect(groups[0].parts.map((p) => p.surface)).toEqual([
      "食べ",
      "たく",
      "なかっ",
      "た"
    ]);
  });

  it("attaches a verb's て but keeps case particles separate", () => {
    const groups = groupSegments([
      { surface: "写真", lemma: "写真", pos: "noun" },
      { surface: "を", lemma: "を", pos: "particle" },
      { surface: "見せ", lemma: "見せる", pos: "verb" },
      { surface: "て", lemma: "て", pos: "particle" }
    ]);
    expect(groups.map((g) => ({ surface: g.surface, lemma: g.lemma }))).toEqual(
      [
        { surface: "写真", lemma: "写真" },
        { surface: "を", lemma: "を" },
        { surface: "見せて", lemma: "見せる" }
      ]
    );
  });
});

describe("describeGroup", () => {
  it("reads a conjugation chain back as base + labelled auxiliaries", () => {
    // WHY (user request): the hover should say what the DETECTED form means in context, not just
    // define the base word — 食べたくなかった carries desire+negation+past on top of 食べる.
    const [group] = groupSegments([
      { surface: "食べ", lemma: "食べる", pos: "verb" },
      { surface: "たく", lemma: "たい", pos: "auxiliary" },
      { surface: "なかっ", lemma: "ない", pos: "auxiliary" },
      { surface: "た", lemma: "た", pos: "auxiliary" }
    ]);
    expect(describeGroup(group)).toBe(
      "食べたくなかった = 食べる + 〜たい (want to) + 〜ない (negation) + 〜た (past)"
    );
  });

  it("labels unknown auxiliaries with their lemma alone, and bare words with nothing", () => {
    // WHY: a wrong grammar label is worse than none; a plain word has nothing to explain.
    const [group] = groupSegments([
      { surface: "行っ", lemma: "行く", pos: "verb" },
      { surface: "けれ", lemma: "けり", pos: "auxiliary" }
    ]);
    expect(describeGroup(group)).toBe("行っけれ = 行く + 〜けり");
    const [bare] = groupSegments([
      { surface: "写真", lemma: "写真", pos: "noun" }
    ]);
    expect(describeGroup(bare)).toBeNull();
  });
});

describe("groupSegments with pre-folded segments", () => {
  it("carries the tokenizer's folded morphemes into the group parts", () => {
    // WHY: the real tokenizer already merges 食べたくなかった into ONE segment (lemma 食べる) and
    // records the raw morphemes in `parts` — the breakdown must read those, not re-tokenize.
    const [group] = groupSegments([
      {
        surface: "食べたくなかった",
        lemma: "食べる",
        pos: "verb",
        parts: [
          { surface: "食べ", lemma: "食べる", pos: "verb" },
          { surface: "たく", lemma: "たい", pos: "auxiliary" },
          { surface: "なかっ", lemma: "ない", pos: "auxiliary" },
          { surface: "た", lemma: "た", pos: "auxiliary" }
        ]
      }
    ]);
    expect(describeGroup(group)).toBe(
      "食べたくなかった = 食べる + 〜たい (want to) + 〜ない (negation) + 〜た (past)"
    );
  });
});

describe("japaneseRuns", () => {
  it("finds every Japanese run in a mixed line, in order with offsets", () => {
    // WHY: the semantic-highlighting walk — miss a run and its words silently stay uncolored.
    expect(japaneseRuns("I ate 食べました and 寿司 today")).toEqual([
      { text: "食べました", start: 6 },
      { text: "寿司", start: 16 }
    ]);
    expect(japaneseRuns("no japanese here")).toEqual([]);
  });
});
