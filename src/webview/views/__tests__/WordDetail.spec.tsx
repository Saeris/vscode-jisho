// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { WordDetail } from "../WordDetail";
import type { SenseDto, WordDetailDto } from "../../../shared/messages";

const sense = (posCodes: string[]): SenseDto => ({
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
  sentences: []
});

const word = (headword: string, posCodes: string[]): WordDetailDto => ({
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
  senses: [sense(posCodes)]
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

  it("shows the table for a conjugable word, collapsed until opened", async () => {
    // WHY: ~30 rows of forms would bury the glosses — the section must exist for verbs but stay
    // out of the way until asked for, like Examples.
    renderView(word("食べる", ["v1", "vt"]));
    const trigger = await screen.findByRole("button", {
      name: "Conjugations"
    });
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(trigger);
    const table = screen.getByRole("table");
    expect(table.textContent).toContain("食べなかった");
    expect(table.textContent).toContain("食べられる (食べれる)");
  });

  it("offers no conjugation section on a non-conjugable word", async () => {
    // WHY: a conjugation table on a plain noun is nonsense; the engine's null gates the section.
    renderView(word("犬", ["n"]));
    await screen.findByText("to eat"); // senses rendered
    expect(screen.queryByRole("button", { name: "Conjugations" })).toBeNull();
  });
});
