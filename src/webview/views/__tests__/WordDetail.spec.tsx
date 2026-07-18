// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { WordDetail } from "../WordDetail";
import type { SenseDto, WordDetailDto } from "../../../shared/messages";

const sense = (
  posCodes: string[],
  sentences: { ja: string; en: string }[] = []
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
  sentences: { ja: string; en: string }[] = []
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
vi.mock("../../queries", () => ({
  wordQuery: (id: string) => ({
    queryKey: ["word", id],
    queryFn: () => current
  })
}));

const renderView = (w: WordDetailDto): void => {
  current = w;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  render(
    wrapper(
      <WordDetail
        id="1"
        onBack={vi.fn<() => void>()}
        onSearchTerm={vi.fn<(term: string) => void>()}
        onOpenKanji={vi.fn<(literal: string) => void>()}
      />
    )
  );
};

describe("word detail conjugations", () => {
  afterEach(cleanup);

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

describe("word detail examples", () => {
  afterEach(cleanup);

  const sentences = [
    { ja: "一", en: "one" },
    { ja: "二", en: "two" },
    { ja: "三", en: "three" }
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
