import { describe, expect, it } from "vitest";
import {
  AUXILIARY_NOTES,
  AUX_GLOSS,
  FORM_NOTES,
  PARTICLE_NOTES,
  exampleReading,
  exampleSurface,
  noteToMarkdown,
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
    // the kind of thing that slips in when adding entries quickly. Contrast examples are held to
    // the same rule — they render in the same places.
    const JAPANESE = /[ぁ-んァ-ヶ㐀-鿿]/;
    const romaji = all()
      .filter(
        ([, note]) =>
          !JAPANESE.test(note.example.ja) ||
          (note.contrast !== undefined && !JAPANESE.test(note.contrast.ja))
      )
      .map(([key]) => key);
    expect(romaji).toEqual([]);
  });

  it("gives every contrast a translation and an explanation", () => {
    // A contrast without its note is just a second sentence — the note is the part that says what
    // the difference IS, which is the whole reason the field exists.
    const incomplete = all()
      .filter(
        ([, note]) =>
          note.contrast !== undefined &&
          (note.contrast.en.trim() === "" || note.contrast.note.trim() === "")
      )
      .map(([key]) => key);
    expect(incomplete).toEqual([]);
  });

  it("resolves ruby markup into a sentence and a readable reading line", () => {
    // Examples are stored as `{本|ほん}` and must reach the hover resolved. Raw braces and pipes
    // would be visible garbage, and because the hover still renders, nothing else would flag it.
    //
    // The reading goes on its own line rather than into <ruby>: VS Code renders ruby, but a probe
    // measured <rt> at 7px against a 14px body and confirmed `style` attributes are stripped, so
    // furigana here is legible-in-principle and unreadable in practice.
    for (const [key, note] of all()) {
      const rendered = noteToMarkdown(key, note);
      expect(rendered, `${key} leaked ruby markup`).not.toMatch(/\{[^}]*\|/u);
      if (/\{.*\|.*\}/u.test(note.example.ja)) {
        // Both halves present: the sentence as written, and its kana reading.
        expect(rendered, `${key} lost its written form`).toContain(
          exampleSurface(note.example.ja)
        );
        expect(rendered, `${key} lost its reading`).toContain(
          exampleReading(note.example.ja)
        );
      }
    }
  });

  it("shares the word hover's frame: h1 heading, rule, blockquote example", () => {
    // The alignment fix — a grammar hover and a definition hover should read as one design. The
    // note leads with an h1 (matching the word hover's headword scale), a --- rule, then the
    // example as a blockquote, mirroring wordHoverMarkdown's structure.
    const md = noteToMarkdown("は", PARTICLE_NOTES.は!);
    expect(md).toMatch(/^# は/);
    expect(md).toContain("\n\n---\n\n");
    expect(md).toContain("> "); // blockquote example
    expect(md).toContain("<small>"); // dimmed translation, like the word hover
  });

  it("gives a reading that is kana only", () => {
    // The reading line exists so a learner who cannot decode the kanji can still say the sentence.
    // A kanji left in it defeats the entire point, and would come from a malformed ruby group.
    const KANJI = /[一-鿿]/u;
    const withKanji = all()
      .filter(([, note]) => KANJI.test(exampleReading(note.example.ja)))
      .map(([key]) => key);
    expect(withKanji).toEqual([]);
  });

  it("spaces examples at word boundaries", () => {
    // Japanese does not write spaces, so a learner cannot see where words end. The examples use the
    // same 分かち書き the extension offers as an editor command — the spacing IS the teaching aid,
    // and losing it in an edit would be silent.
    // Keyed off ruby groups rather than character count: a sentence with two or more kanji words
    // certainly has a boundary between them, whereas a single conjugated word (おいしそうです,
    // 忘れちゃった) legitimately has none and would fail a length-based heuristic.
    const multiWord = all().filter(
      ([, note]) => (note.example.ja.match(/\{[^}]*\|/gu) ?? []).length >= 2
    );
    expect(multiWord.length).toBeGreaterThan(10);
    const unspaced = multiWord
      .filter(([, note]) => !note.example.ja.includes(" "))
      .map(([key]) => key);
    expect(unspaced).toEqual([]);
  });

  it("treats emphasis-not-meaning pairs as distinct, never interchangeable", () => {
    // User correction, and the reason this test exists: an earlier draft called に and へ
    // "interchangeable". They are not — に emphasises the destination, へ the direction — and
    // teaching them as swappable trains a learner to stop noticing a distinction that carries real
    // meaning in conversation. Japanese has a whole class of these, where two forms describe one
    // situation and differ in what they put the weight on.
    const emphasisPairs = ["へ", "が"];
    for (const key of emphasisPairs) {
      expect(PARTICLE_NOTES[key]?.detail.toLowerCase()).not.toContain(
        "interchangeable"
      );
    }
    // Each carries a second phrasing of the SAME situation: the only way to show emphasis, since
    // there is no English contrast to define it against.
    expect(PARTICLE_NOTES.へ?.contrast).toBeDefined();
    expect(PARTICLE_NOTES.が?.contrast).toBeDefined();
  });

  it("shows the giving/receiving trio from each vantage point", () => {
    // These three describe ONE event and differ only in whose perspective the sentence takes —
    // the nuance the user flagged as hardest for English speakers, because English picks a single
    // phrasing ("a friend taught me") where Japanese makes you choose a side. A definition alone
    // cannot carry that, so each note has to show the same fact told the other way.
    for (const lemma of ["あげる", "もらう", "くれる"]) {
      const note = AUXILIARY_NOTES[lemma];
      expect(
        note?.contrast,
        `${lemma} needs a contrasting phrasing`
      ).toBeDefined();
      expect(note?.contrast?.ja).not.toBe(note?.example.ja);
    }
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
