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
  sentences: { jaFurigana: string; en: string }[] = []
): WordDetailDto => ({
  id: "1",
  common: true,
  jlpt: null,
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
});
