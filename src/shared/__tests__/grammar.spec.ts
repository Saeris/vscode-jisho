import { describe, expect, it } from "vitest";
import {
  AUXILIARY_NOTES,
  AUX_GLOSS,
  FORM_NOTES,
  PARTICLE_NOTES,
  type GrammarNote
} from "../grammar";
import { conjugate } from "../../webview/conjugate";

const notes = (
  record: Record<string, GrammarNote | undefined>
): [string, GrammarNote][] =>
  Object.entries(record).filter((entry): entry is [string, GrammarNote] => {
    return entry[1] !== undefined;
  });

const all = (): [string, GrammarNote][] => [
  ...notes(PARTICLE_NOTES),
  ...notes(AUXILIARY_NOTES),
  ...notes(FORM_NOTES)
];

describe("grammar note coverage", () => {
  it("explains every auxiliary the breakdown chain can label", () => {
    // The chain line and the hover notes are two views of one dataset. If a lemma can appear in the
    // breakdown as "〜しまう (completion)" but hovering it explains nothing, the feature is silently
    // half-present for that word — the failure a reader would report as "it works for some verbs".
    const missing = Object.keys(AUX_GLOSS).filter(
      (lemma) => AUXILIARY_NOTES[lemma] === undefined
    );
    expect(missing).toEqual([]);
  });

  it("explains every form the conjugation table can render", () => {
    // Term tooltips key off these exact labels, so a form conjugate() emits without a note renders
    // as plain text with no tooltip — invisible in review, and only noticed by a learner who
    // hovered the one row that has nothing to say.
    const emitted = new Set<string>();
    // Spans every table shape: ichidan, godan, the two irregulars, and both adjective classes —
    // each of which emits a different row set.
    for (const [surface, pos] of [
      ["食べる", "v1"],
      ["読む", "v5m"],
      ["する", "vs-i"],
      ["来る", "vk"],
      ["高い", "adj-i"],
      ["静か", "adj-na"]
    ] as const) {
      for (const row of conjugate(surface, [pos]) ?? []) emitted.add(row.form);
    }
    // Guard against the assertion passing because conjugate() returned nothing at all.
    expect(emitted.size).toBeGreaterThan(5);
    const missing = [...emitted].filter(
      (form) => FORM_NOTES[form] === undefined
    );
    expect(missing).toEqual([]);
  });
});

describe("grammar note quality", () => {
  it("keeps every gist to a headline rather than a paragraph", () => {
    // A gist is the one line shown before the reader decides whether to keep reading, so it has to
    // stay scannable. The threshold is 120 rather than the spec's "~80": the two longest gists
    // (Non-past at 108, Te-form at 98) are inherited verbatim from the conjugation hints the user
    // singled out as good, and trimming approved wording to satisfy a number invented here would be
    // the wrong way round. This still catches a gist that has grown into prose.
    const tooLong = all()
      .filter(([, note]) => note.gist.length > 120)
      .map(([key, note]) => `${key} (${note.gist.length})`);
    expect(tooLong).toEqual([]);
  });

  it("gives every note a real explanation, not a restated gist", () => {
    // The detail is the reason this dataset exists rather than reusing JMdict's one-line glosses.
    // A detail shorter than its gist means someone filled the field to satisfy the type.
    const thin = all()
      .filter(([, note]) => note.detail.length <= note.gist.length)
      .map(([key]) => key);
    expect(thin).toEqual([]);
  });

  it("gives every note a worked example in both languages", () => {
    const incomplete = all()
      .filter(
        ([, note]) =>
          note.example.ja.trim() === "" || note.example.en.trim() === ""
      )
      .map(([key]) => key);
    expect(incomplete).toEqual([]);
  });

  it("demonstrates each particle and auxiliary in its own example", () => {
    // An example that does not contain the thing it illustrates is not an example of it.
    //
    // Matched on the STEM, not the whole lemma, because auxiliaries appear conjugated in real
    // sentences and almost never in dictionary form: しまう shows up as 〜てしまった, くれる as
    // 〜てくれた, れる as 〜れた. Demanding the citation form would have forced unnatural Japanese
    // into the examples — the opposite of what this dataset is for. Particles are matched whole,
    // since they do not inflect.
    //
    // そうだ/ようだ are exempt: they attach across a clause boundary, so the sentence contains そう
    // and だ without them being adjacent.
    const exempt = new Set(["そうだ", "ようだ"]);
    // Drop the final mora for anything that inflects. Two-character auxiliaries inflect too (おく →
    // おき, れる → れ), so the cut applies from length 2 up; single-character ones (た, て, ん) are
    // already minimal.
    const stem = (lemma: string): string =>
      lemma.length >= 2 ? lemma.slice(0, -1) : lemma;
    const absent = [
      ...notes(PARTICLE_NOTES).map(([key, note]) => [key, key, note] as const),
      ...notes(AUXILIARY_NOTES).map(
        ([key, note]) => [key, stem(key), note] as const
      )
    ]
      .filter(
        ([key, needle, note]) =>
          !exempt.has(key) && !note.example.ja.includes(needle)
      )
      .map(([key]) => key);
    expect(absent).toEqual([]);
  });

  it("writes examples in Japanese script, never romaji", () => {
    // A stated content rule: romaji in an example would teach the wrong reading habit, and it is
    // the kind of thing that slips in when adding entries quickly.
    const JAPANESE = /[ぁ-んァ-ヶ㐀-鿿]/;
    const romaji = all()
      .filter(([, note]) => !JAPANESE.test(note.example.ja))
      .map(([key]) => key);
    expect(romaji).toEqual([]);
  });

  it("cross-references the pairs learners confuse", () => {
    // は/が and に/で are the two distinctions where explaining one alone reliably produces a
    // confident wrong rule. The spec calls for the cross-reference explicitly; this pins it so a
    // later rewrite cannot quietly drop it.
    expect(PARTICLE_NOTES.は?.detail).toContain("が");
    expect(PARTICLE_NOTES.が?.detail).toContain("は");
    expect(PARTICLE_NOTES.に?.detail).toContain("で");
    expect(PARTICLE_NOTES.で?.detail).toContain("に");
  });
});
