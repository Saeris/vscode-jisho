import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { WordDetail } from "../WordDetail";
import { renderWithNavigation } from "../../__tests__/navigationHarness";
import type { NavEvent } from "../../machines/navigation";
import type { SenseDto, WordDetailDto } from "../../../shared/messages";

const sense = (
  posCodes: string[],
  sentences: { jaFurigana: string; en: string }[] = []
): SenseDto => ({
  partOfSpeech: posCodes.map((code) => ({ code, description: code })),
  field: [],
  misc: [],
  info: [],
  dialect: [],
  glosses: ["to eat"],
  appliesToKanji: ["*"],
  appliesToKana: ["*"],
  related: [],
  antonym: [],
  sentences
});

const word = (
  headword: string,
  posCodes: string[],
  sentences: { jaFurigana: string; en: string }[] = [],
  /** Sentences on the "more examples" page; the default is enough for the link to be offered. */
  poolExamples = 20
): WordDetailDto => ({
  id: "1",
  common: true,
  jlpt: null,
  poolExamples,
  kanji: [{ text: headword, common: true, tags: [] }],
  kana: [
    {
      text: "reading",
      common: true,
      tags: [],
      appliesToKanji: ["*"],
      pitchAccents: []
    }
  ],
  senses: [sense(posCodes, sentences)]
});

let current: WordDetailDto;
/** Per-literal kanji details for the Kanji section; anything absent resolves to null (no row). */
let kanjiDetails: Record<string, unknown> = {};
vi.mock("../../queries", () => ({
  wordQuery: (id: string) => ({
    queryKey: ["word", id],
    queryFn: () => current
  }),
  kanjiQuery: (literal: string) => ({
    queryKey: ["kanji", literal],
    queryFn: () => kanjiDetails[literal] ?? null
  })
}));

const renderView = (
  w: WordDetailDto,
  kanji: Record<string, unknown> = {}
): NavEvent[] => {
  current = w;
  kanjiDetails = kanji;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  return renderWithNavigation(wrapper(<WordDetail id="1" />)).sent;
};

describe("word detail conjugations", () => {
  it("shows the table for a conjugable word, visible without interaction", async () => {
    // WHY (user feedback): the collapsed-disclosure version hid the content — the section split
    // should come from the heading, not a collapse. The table renders below the senses directly.
    renderView(word("食べる", ["v1", "vt"]));
    const table = await screen.findByRole("table");
    expect(table.textContent).toContain("食べなかった");
    expect(table.textContent).toContain("食べられる (食べれる)");
    // Throws if the section heading is missing.
    screen.getByRole("heading", { name: "Conjugations" });
  });

  it("emphasises the part of each form that differs from the dictionary form", async () => {
    // WHY (user feedback): most forms attach to a changed stem, and it's easy to misread where
    // the word ends and the conjugation begins — the differing tail gets its own colour. Whole-word
    // replacements must emphasise everything (that's the trap worth flagging).
    renderView(word("食べる", ["v1"]));
    const table = await screen.findByRole("table");
    const marked = [
      ...table.querySelectorAll<HTMLElement>('[class*="inflection"]')
    ].map((el) => el.textContent);
    expect(marked).toContain("た"); // past: 食べ|た
    expect(marked).toContain("なかった"); // past negative: 食べ|なかった
    expect(marked).not.toContain("食べる"); // the dictionary form itself has no differing tail
  });

  it("offers no conjugation section on a non-conjugable word", async () => {
    // WHY: a conjugation table on a plain noun is nonsense; the engine's null gates the section.
    renderView(word("犬", ["n"]));
    await screen.findByText("to eat"); // senses rendered
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Conjugations" })).toBeNull();
  });
});

describe("word detail form marks & sections", () => {
  it("flags search-only writings with 探 and explains it in the legend", async () => {
    // WHY (Shirabe reference): 喰べる exists so searches FIND it, but presenting it as a normal
    // alternative teaches learners a form nobody writes — the mark plus legend says so.
    const w = word("食べる", ["v1"]);
    w.kanji.push({ text: "喰べる", common: false, tags: ["sK"] });
    renderView(w);
    await screen.findByText("to eat");
    // Twice: the superscript on the writing AND the legend line explaining it.
    expect(screen.getAllByText("探")).toHaveLength(2);
    screen.getByText(/search-only form/);
  });

  it("shows no legend when no writing carries a form tag", async () => {
    renderView(word("食べる", ["v1"]));
    await screen.findByText("to eat");
    expect(screen.queryByText(/search-only form/)).toBeNull();
  });

  it("renders a kanji row per character with an entry, none for gaps", async () => {
    // WHY: the Kanji section must never dead-end — a character without a Kanjidic entry gets no
    // row at all rather than a row that opens "Kanji not found".
    current = word("食べる", ["v1"]);
    kanjiDetails = {
      食: {
        literal: "食",
        meanings: ["eat", "food"],
        on: ["ショク"],
        kun: ["た.べる"]
      }
    };
    const { sent } = renderWithNavigation(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity } }
          })
        }
      >
        <WordDetail id="1" />
      </QueryClientProvider>
    );
    const row = await screen.findByRole("button", { name: "View kanji 食" });
    expect(row.textContent).toContain("eat, food");
    await userEvent.click(row);
    expect(sent).toEqual([{ type: "openKanji", literal: "食" }]);
  });
});

describe("word detail examples", () => {
  const sentences = [
    { jaFurigana: "一", en: "one" },
    { jaFurigana: "二", en: "two" },
    { jaFurigana: "三", en: "three" }
  ];

  it("shows the first examples inline and the rest behind Show all", async () => {
    // WHY (user feedback): collapsed-by-default examples made the page read as if it had none.
    // A couple visible carries the value; the long tail stays out of the way until asked for.
    renderView(word("食べる", ["v1"], sentences));
    // The getters throw when absent, so bare calls assert presence.
    await screen.findByText("一");
    screen.getByText("二");
    expect(screen.queryByText("三")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show all (3)" }));
    screen.getByText("三");
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("offers the more-examples page only when the pool is worth a page", async () => {
    // WHY (user report, confirmed by measurement): the link used to render unconditionally on the
    // assumption that "the pool exists for the vast majority of words". Against the shipped
    // dictionary that is false — 47.8% of words have an EMPTY pool — so nearly half of all taps
    // landed on a blank page. A pool of one or two is just as bad: the page is nominally non-empty
    // but says less than the inline examples already on this page.
    renderView(word("食べる", ["v1"], sentences, 0));
    await screen.findByText("一");
    expect(screen.queryByRole("button", { name: /more examples/i })).toBeNull();

    renderView(word("食べる", ["v1"], sentences, 2));
    await screen.findByText("一");
    expect(screen.queryByRole("button", { name: /more examples/i })).toBeNull();
  });

  it("puts the pool size in the link, so the tap is an informed one", async () => {
    // WHY: "More examples" promised an unknown quantity — the reason a one-sentence page felt
    // broken rather than merely small. The count sets the expectation before navigating.
    renderView(word("食べる", ["v1"], sentences, 20));
    await screen.findByText("一");
    expect(
      screen.getByRole("button", { name: /20 more examples/i })
    ).toBeInTheDocument();
  });
});

describe("word detail common marker", () => {
  it("renders 'common' as a pill alongside the grammar tags", async () => {
    // WHY (user feedback): it was a filled accent Badge sitting directly above the outlined
    // grammar pills, so it read as a stray element rather than as one of the word's tags. It stays
    // the most prominent marker in the row — just in the same family.
    renderView(word("食べる", ["v1"]));
    const common = await screen.findByText("common");
    const pos = screen.getByText("ichidan verb");
    // Same pill CLASS as a grammar tag, which is what makes the two read as one family. Not the
    // same element: a grammar tag whose category the browse tree offers is a <button> that opens
    // that list (#27), while "common" is a marker with nowhere to go.
    expect(common.className).toContain("pill");
    expect(pos.className).toContain("pill");
    // But NOT inside the per-sense row: that repeats whenever the grammar changes, and "common" is
    // a word-level fact that must appear exactly once.
    expect(common.parentElement).not.toBe(pos.parentElement);
    // It explains itself on hover, like every other pill.
    expect(common).toHaveAttribute("title", expect.stringContaining("common"));
  });
});
