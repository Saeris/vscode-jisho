import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import type { WiktionaryEntry } from "../extract-wiktionary";
import type { RegionalGroup } from "../regional";
import {
  crossCheck,
  fetchWiktionary,
  noteText,
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

describe("wiktionary's notes", () => {
  it("keeps the prose of an etymology and drops a pronunciation table left in it", () => {
    // WHY: Wiktextract sometimes leaves a page's pronunciation list in the etymology (嫂 has 92
    // such lines). Shown as a note, it would bury the one sentence about the shape.
    expect(
      noteText(
        "Phono-semantic compound: semantic 女 + phonetic 叟\n* Mandarin\n*:(Pinyin): sǎo"
      )
    ).toBe("Phono-semantic compound: semantic 女 + phonetic 叟");
    expect(noteText("* Mandarin\n*:(Pinyin): sháo")).toBeNull();
  });

  it("is not taken from a page that only sends the reader elsewhere", () => {
    // WHY: "see 鮐" says nothing of where 台's shape came from, and out of Wiktionary it reads as a
    // broken instruction.
    expect(
      noteText(
        "For pronunciation and definitions of 台 – see 鮐.\n(This character is a variant form of 鮐)."
      )
    ).toBeNull();
  });

  it("takes each section's first note, and never the Japanese section's", () => {
    // WHY: 學 has three Chinese etymologies and only the first explains its parts; and a Japanese
    // entry's etymology is the word's history ("From Middle Chinese 學"), not the shape's.
    const { notes } = parseWiktionary([
      entry("學", "Chinese", {
        etymology_text: "Possibly a phono-semantic compound."
      }),
      entry("學", "Chinese", { etymology_text: "Alternative form of 斆." }),
      entry("学", "Translingual", {
        etymology_text: "Simplified from 學 (𦥯 → 𰃮)."
      }),
      entry("学", "Japanese", {
        pos: "noun",
        etymology_text: "From Middle Chinese 學 (MC haewk)."
      })
    ]);
    expect(Object.fromEntries(notes)).toEqual({
      學: { Chinese: "Possibly a phono-semantic compound." },
      学: { Translingual: "Simplified from 學 (𦥯 → 𰃮)." }
    });
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
