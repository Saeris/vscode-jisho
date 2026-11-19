import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import type { NoteBlock, NoteItem } from "../../src/shared/messages";
import type { WiktionaryEntry } from "../extract-wiktionary";
import type { RegionalGroup } from "../regional";
import {
  MAX_SENSES,
  chineseSenses,
  crossCheck,
  fetchWiktionary,
  japaneseReadings,
  noteBlocks,
  parseWiktionary,
  unexplained,
  type CrossCheck
} from "../wiktionary";

/** A group with only what the cross-check reads: its name and its forms. */
const group = (key: string, chars: string, old?: string): RegionalGroup => {
  const [cn = "", hk = "", tw = "", jp = ""] = Array.from(chars);
  return {
    key,
    chars: [cn, hk, tw, jp],
    ...(old === undefined ? {} : { old }),
    glyphSig: "0000",
    cpSig: "0000",
    tiers: [1, 1, 1, 1]
  };
};

const entry = (
  word: string,
  lang: string,
  fields: Partial<WiktionaryEntry> = {}
): WiktionaryEntry => ({ word, lang, pos: "character", ...fields });

const para = (text: string, indent = false): NoteBlock => ({
  kind: "paragraph",
  text,
  indent
});
const item = (text: string, items: NoteItem[] = []): NoteItem => ({
  text,
  items
});

describe("wiktionary's notes", () => {
  it("drops a pronunciation table left in the etymology, in either of its shapes", () => {
    // WHY: Wiktextract leaves a page's pronunciation table in 31 etymologies (奸's runs to 78
    // lines, ending in a note on its Wu readings). Shown as a note, it would bury the one
    // sentence about the shape.
    const shape = "Phono-semantic compound: semantic 女 + phonetic 干";
    expect(
      noteBlocks(
        `${shape}\n* Mandarin\n*:(Pinyin): jiān (jian¹)\n* Cantonese (Jyutping): gaan¹`
      )
    ).toEqual([para(shape)]);
    expect(
      noteBlocks(
        `${shape}\n* Wu\n** (Northern: Shanghai)\n*** Wugniu: ¹ke\nNote:\n* ¹ke - vernacular;\n* ¹ji - literary.`
      )
    ).toEqual([para(shape)]);
    expect(noteBlocks("* Mandarin\n*:(Pinyin): sháo")).toBeNull();
  });

  it("keeps the page's own bullets, which the old filter threw away with the tables", () => {
    // WHY: many of the Chinese notes' `*` lines are bullets of real content (西: "Related to
    // Tibetan ner ba"); dropping every `*` line to lose the tables lost them too.
    expect(
      noteBlocks(
        "From Proto-Sino-Tibetan *nup.\n* Related to Tibetan ནེར་བ (ner ba).\n** Also Chepang nelʔ-."
      )
    ).toEqual([
      para("From Proto-Sino-Tibetan *nup."),
      {
        kind: "list",
        ordered: false,
        items: [
          item("Related to Tibetan ནེར་བ (ner ba).", [
            item("Also Chepang nelʔ-.")
          ])
        ]
      }
    ]);
  });

  it("numbers a numbered list and joins a line that continues an item", () => {
    // WHY (reported): 商's note showed "# Inverted triangle…" as text. `#` is the page's numbered
    // list, and `*:` (東) carries on the item above rather than starting one.
    expect(
      noteBlocks(
        "The element atop 丙 varies:\n# Inverted triangle.\n# 辛-like form.\n#: See type 1."
      )
    ).toEqual([
      para("The element atop 丙 varies:"),
      {
        kind: "list",
        ordered: true,
        items: [item("Inverted triangle."), item("辛-like form. See type 1.")]
      }
    ]);
  });

  it("keeps a sense's label with what is said under it, and drops one with nothing under it", () => {
    // WHY (reported): Wiktextract keeps the labels of 商's etymology (";dynasty's name") but not
    // the paragraphs under them, so they showed as bare headings. 侯's label has its text (`:`).
    expect(
      noteBlocks(
        'Pictogram – a target for arrows.\n;"target" > "prince"\n:Schuessler proposes an etymology.\n;dynasty\'s name\n;“to discuss”'
      )
    ).toEqual([
      para("Pictogram – a target for arrows."),
      { kind: "label", text: '"target" > "prince"' },
      para("Schuessler proposes an etymology.", true)
    ]);
  });

  it("sets in a line whose markup it does not know, rather than stopping on it", () => {
    // WHY: the build parses every page, and a line that no rule consumes (`:;`) would leave the
    // parser looping on it forever, hanging the build. Shown set in, its text is still quoted.
    expect(noteBlocks("A compound.\n:;An odd line.")).toEqual([
      para("A compound."),
      para("An odd line.", true)
    ]);
  });

  it("is not taken from a page that only sends the reader elsewhere", () => {
    // WHY: "see 鮐" says nothing of where 台's shape came from, and out of Wiktionary it reads as a
    // broken instruction.
    expect(
      noteBlocks(
        "For pronunciation and definitions of 台 – see 鮐.\n(This character is a variant form of 鮐)."
      )
    ).toBeNull();
  });

  it("takes the first Translingual and Chinese note of a page", () => {
    // WHY: 學 has three Chinese etymologies and only the first explains its parts; the others
    // ("Alternative form of 斆") are about other words written 學.
    const { notes } = parseWiktionary([
      entry("學", "Chinese", {
        etymology_text: "Possibly a phono-semantic compound."
      }),
      entry("學", "Chinese", { etymology_text: "Alternative form of 斆." }),
      entry("学", "Translingual", {
        etymology_text: "Simplified from 學 (𦥯 → 𰃮)."
      })
    ]);
    expect(Object.fromEntries(notes)).toEqual({
      學: { Chinese: [para("Possibly a phono-semantic compound.")] },
      学: { Translingual: [para("Simplified from 學 (𦥯 → 𰃮).")] }
    });
  });

  it("gives every Japanese etymology, each under the readings it is the history of", () => {
    // WHY (asked for): the view gives each language's etymology, and a kanji's Japanese words come
    // from different places: 国's くに from Old Japanese, its こく from Middle Chinese. The page has one
    // entry per reading and part of speech, so a text shared by several entries is shown once, under
    // all their readings.
    const head = (reading: string): WiktionaryEntry["head_templates"] => [
      { expansion: `国(${reading}) • (romaji)` }
    ];
    const { notes } = parseWiktionary([
      entry("国", "Japanese", { pos: "character", forms: [] }),
      entry("国", "Japanese", {
        pos: "noun",
        etymology_text: "From Old Japanese.",
        head_templates: head("くに")
      }),
      entry("国", "Japanese", {
        pos: "noun",
        etymology_text: "From Middle Chinese 國.",
        head_templates: head("こく")
      }),
      entry("国", "Japanese", {
        pos: "suffix",
        etymology_text: "From Middle Chinese 國.",
        head_templates: head("ごく")
      })
    ]);
    expect(notes.get("国")?.Japanese).toEqual([
      { kind: "label", text: "くに" },
      para("From Old Japanese."),
      { kind: "label", text: "こく、ごく" },
      para("From Middle Chinese 國.")
    ]);
  });

  it("leaves out a Japanese entry that only points elsewhere, and a given name", () => {
    // WHY: 後's "Uncommon alternative spelling" is about another word's spelling, and 学's given
    // names (さとる, まなぶ) would put names among the readings of the character's own words.
    const { notes } = parseWiktionary([
      entry("学", "Japanese", {
        pos: "noun",
        etymology_text: "From Middle Chinese 學.",
        head_templates: [{ expansion: "学(がく) • (gaku)" }]
      }),
      entry("学", "Japanese", {
        pos: "name",
        etymology_text: "From Middle Chinese 學.",
        head_templates: [
          { expansion: "学(さとる) or 学(まなぶ) • (Satoru or Manabu)" }
        ]
      }),
      entry("学", "Japanese", {
        pos: "character",
        etymology_text: "Uncommon alternative spelling.",
        redirects: ["學"]
      })
    ]);
    expect(notes.get("学")?.Japanese).toEqual([
      { kind: "label", text: "がく" },
      para("From Middle Chinese 學.")
    ]);
  });
});

describe("a Japanese headword's readings", () => {
  it("takes the kana in brackets, not the romanization or a historical spelling", () => {
    // WHY: the headword line carries the reading three ways; the label is the one a learner reads.
    expect(
      japaneseReadings(
        entry("商", "Japanese", {
          head_templates: [
            { expansion: "商(しょう) • (shō) ^(←しやう (syau)?)" }
          ]
        })
      )
    ).toEqual(["しょう"]);
  });
});

describe("meanings in Chinese", () => {
  it("keeps the living, standard senses, with their register", () => {
    // WHY: "Meanings in Chinese" sets the standard language's meanings beside the kanji's. A
    // dialect's sense (Hokkien, Cantonese and some 150 places), a dead one, or one that only points
    // at another character would each misstate what the character means.
    expect(
      chineseSenses([
        { glosses: ["hot or boiling water"], tags: ["literary", "regional"] },
        { glosses: ["broth; stock"] },
        { glosses: ["pus"], tags: ["Min", "Southern"] },
        { glosses: ["capital"], tags: ["obsolete"] },
        {
          glosses: ["alternative form of 蕩"],
          tags: ["alt-of", "alternative"]
        },
        { glosses: ["dinner; meal"], tags: ["Mandarin", "dialectal"] },
        { glosses: ["to learn; to study"], tags: ["transitive"] }
      ])
    ).toEqual([
      { gloss: "hot or boiling water", labels: ["literary", "regional"] },
      { gloss: "broth; stock", labels: [] },
      { gloss: "to learn; to study", labels: [] }
    ]);
  });

  it("leaves out a use that is not a meaning, and a sub-sense", () => {
    // WHY: "a surname", "Classifier for countries" or "synonym of 日元" say how the character is
    // used, not what it means (円's only sense is the last); and a sub-sense refines the one above.
    expect(
      chineseSenses([
        { glosses: ["a surname"] },
        { glosses: ["Classifier for countries (quasi-measure word)."] },
        { glosses: ["synonym of 日元 (rìyuán, “Japanese yen”)"] },
        { glosses: ["used in 學鳩"] },
        { glosses: ["to issue"] },
        { glosses: ["to issue", "to publish"] }
      ])
    ).toEqual([{ gloss: "to issue", labels: [] }]);
  });

  it("sets a sense's context before it, as Wiktionary does", () => {
    // WHY: 走's "to run; to work" is said of devices; without that, the gloss tells a learner 走
    // means "to run", the meaning Japanese has and Chinese lost.
    expect(
      chineseSenses([
        { glosses: ["to run; to work"], raw_tags: ["of devices"] }
      ])
    ).toEqual([{ gloss: "(of devices) to run; to work", labels: [] }]);
  });

  it("takes the first few, across the page's entries, in its order", () => {
    // WHY: Wiktionary orders a page's senses from its first etymology on; the view has room for
    // a few, so the page's first ones, not a sample.
    const { meanings } = parseWiktionary([
      entry("湯", "Chinese", {
        senses: [{ glosses: ["broth; stock"] }, { glosses: ["soup"] }]
      }),
      entry("湯", "Chinese", {
        senses: [
          { glosses: ["to touch"] },
          { glosses: ["to meet with"] },
          { glosses: ["rushing; great"] },
          { glosses: ["hot spring"] }
        ]
      }),
      entry("湯", "Japanese", { senses: [{ glosses: ["hot water"] }] })
    ]);
    expect(meanings.get("湯")?.map((sense) => sense.gloss)).toEqual([
      "broth; stock",
      "soup",
      "to touch",
      "to meet with",
      "rushing; great"
    ]);
    expect(MAX_SENSES).toBe(5);
  });
});

describe("the cross-check with Wiktionary", () => {
  // Japan's reform labels, written from either side as Wiktionary does: 学 and 娯 name their
  // kyūjitai, 國 and 喻 their shinjitai.
  const wiktionary = parseWiktionary([
    entry("学", "Japanese", { forms: [{ form: "學", tags: ["kyūjitai"] }] }),
    entry("國", "Japanese", { forms: [{ form: "国", tags: ["shinjitai"] }] }),
    entry("娯", "Japanese", { forms: [{ form: "娛", tags: ["kyūjitai"] }] }),
    entry("喻", "Japanese", { forms: [{ form: "喩", tags: ["shinjitai"] }] }),
    entry("弁", "Japanese", { forms: [{ form: "辯", tags: ["kyūjitai"] }] }),
    entry("専", "Japanese", { forms: [{ form: "專", tags: ["kyūjitai"] }] }),
    entry("专", "Chinese", { pos: "soft-redirect", redirects: ["專"] }),
    entry("鹇", "Chinese", { pos: "soft-redirect", redirects: ["鷳"] }),
    entry("鷴", "Chinese", { etymology_text: "Variant of 鷳." })
  ]);

  it("lists a reform pair that no group holds together", () => {
    // WHY: Wiktionary's shinjitai and kyūjitai labels are the cleanest it has, so a pair we keep
    // apart is either a grouping mistake or a decision that needs its reason written down. A label
    // can sit on either page, so each pair here is named from one side only.
    const found = crossCheck(
      [
        group("學", "学學學学", "學"),
        group("國", "国國國国", "國"),
        group("喻", "喻喻喻喻"),
        group("喩", "喩喩喩喩"),
        group("娯", "娯娯娯娯"),
        group("娛", "娱娛娛娛")
      ],
      wiktionary
    );
    expect(found.split).toEqual(["喩喻", "娯娛"]);
  });

  it("finds a pair together in any one of a form's groups", () => {
    // WHY: Japan's reform made one shape of several characters (弁 for 辨, 瓣, 辯), so 弁 is a form
    // in four groups; holding 辯 in one of them is enough.
    const found = crossCheck(
      [
        group("辨", "辨辨辨弁", "辨"),
        group("辯", "辩辯辯弁", "辯"),
        group("弁", "弁弁弁弁")
      ],
      wiktionary
    );
    expect(found.split).toEqual([]);
  });

  it("ignores a pair with a form no group writes", () => {
    // WHY: the extraction holds every Han character; a pair outside our scope says nothing about the
    // grouping. Here no group writes 學, so 学's label names nothing we could have split.
    expect(crossCheck([group("学", "学学学学")], wiktionary).split).toEqual([]);
  });

  it("counts a chain of links through the group's own forms, but not through another form", () => {
    // WHY: Wiktionary has no clean label for China's simplification, so 专 reaches 専 only through
    // 專; that joins 專's group. 鹇 and 鷴 meet only at 鷳, which is not in their group, so the group
    // is listed: Wiktionary itself does not say the two are one character.
    const found = crossCheck(
      [group("專", "专專專専"), group("鷴", "鹇鷴鷴鷴")],
      wiktionary
    );
    expect(found.unconnected).toEqual(["鷴"]);
  });
});

describe("explaining the cross-check", () => {
  const explained = {
    split: [["a reason", ["喩喻"]]],
    unconnected: [["another reason", "鷴"]]
  } as const;
  const found = (split: string[], unconnected: string[]): CrossCheck => ({
    split,
    unconnected
  });

  it("passes when every difference has a reason", () => {
    expect(unexplained(found(["喩喻"], ["鷴"]), explained)).toEqual({
      differences: [],
      stale: []
    });
  });

  it("names a new difference and a reason whose difference is gone", () => {
    // WHY: the record is the safety net for the grouping. A new difference must be looked at, and a
    // reason left behind after a fix would hide the same difference if it came back.
    expect(unexplained(found(["娯娛"], []), explained)).toEqual({
      differences: ["split 娯娛"],
      stale: ["split 喩喻", "unconnected 鷴"]
    });
  });
});

describe("reading the pinned extraction", () => {
  it("refuses an extraction whose checksum is not the pinned one", async () => {
    // WHY: a release asset can be replaced in place. The pin is what makes two builds of one commit
    // show the same notes, so other bytes must fail the build, not change the notes quietly.
    const bytes = gzipSync(
      `${JSON.stringify(entry("学", "Translingual", { etymology_text: "Simplified from 學." }))}\n`
    );
    await expect(
      fetchWiktionary(async () => new Response(bytes))
    ).rejects.toThrow(/is pinned/u);
  });
});
