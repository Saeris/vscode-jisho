import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderWithNavigation as render } from "../../__tests__/navigationHarness";
import type { NavEvent } from "../../machines/navigation";
import { SearchResults } from "../SearchResults";
import type { SearchResultDto, SegmentDto } from "../../../shared/messages";

// Mock the query layer so results are deterministic and synchronous — this test is about the
// keyboard-navigation + rendering wiring (BACKLOG #12), not the bridge/host round-trip.
const words: SearchResultDto[] = [
  {
    id: "1",
    headword: "食べる",
    reading: "たべる",
    common: true,
    glossPreview: "to eat",
    jlpt: 5
  },
  {
    id: "2",
    headword: "食う",
    reading: "くう",
    common: true,
    glossPreview: "to eat (coarse)",
    jlpt: null
  }
];
// SearchResults imports the bridge directly for the settings gear; the real module calls
// acquireVsCodeApi at load, which exists only inside a real VS Code webview.
vi.mock("../../bridge", () => ({
  openSettings: vi.fn<() => Promise<void>>(async () => undefined),
  // `ErrorState` reports through the bridge, and the results list renders it on a failed query.
  reportCrash: vi.fn<() => Promise<void>>(async () => undefined),
  // The recent-search history round-trips through the host; these stubs keep it inert so these
  // tests stay about the results list.
  recordRecentSearch: vi.fn<() => Promise<{ recent: [] }>>(async () => ({
    recent: []
  })),
  clearRecentSearches: vi.fn<() => Promise<{ recent: [] }>>(async () => ({
    recent: []
  }))
}));

// The breakdown bar only renders when the host returns segments, which it does for a multi-word
// Japanese query. Mutable so a single test can turn it on without a second mock factory.
const segments = vi.hoisted(() => ({ current: [] as SegmentDto[] }));
// Likewise for the result rows, so the full-match split can be given a query that IS one of them.
const results = vi.hoisted(() => ({
  current: null as SearchResultDto[] | null
}));

vi.mock("../../queries", () => ({
  searchQuery: (query: string) => ({
    queryKey: ["search", query],
    queryFn: () => ({
      words: results.current ?? words,
      kanji: [],
      segments: segments.current
    }),
    enabled: query.trim().length > 0
  }),
  namesQuery: (query: string) => ({
    queryKey: ["names", query],
    queryFn: () => [],
    enabled: query.trim().length > 0
  }),
  // Tag-filter sets (#27). Never consulted here — these tests type plain text, so no tag token
  // exists and `useQueries` is called with an empty list — but the module must still export it.
  browseQuery: (id: string) => ({
    queryKey: ["browse", id],
    queryFn: () => ({ results: [], total: 0 })
  }),
  // Refining counts for the tag autocomplete. Empty here — these tests type plain text, so no
  // suggestion menu opens — but the module must still export it.
  browseCountsQuery: (applied: string[] = []) => ({
    queryKey: ["browseCounts", applied.join(",")],
    queryFn: () => ({ counts: {}, namesAvailable: false })
  }),
  // Empty history, so the empty view falls back to its hint — these tests are about results.
  recentSearchesQuery: () => ({
    queryKey: ["recentSearches"],
    queryFn: () => []
  })
}));

/** Render the view and return the navigation events it dispatched. */
const renderView = (
  props?: Partial<Parameters<typeof SearchResults>[0]>
): NavEvent[] => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  return render(
    wrapper(<SearchResults query="食べる" selectedSegment={null} {...props} />)
  ).sent;
};

describe("search results (rendering + query wiring)", () => {
  it("renders word results with their headwords and readings", async () => {
    renderView();
    await expect(screen.findByText("食べる")).resolves.toBeDefined();
    expect(screen.getByText("食う")).toBeDefined();
    expect(screen.getByText("たべる")).toBeDefined();
  });

  it("shows a prompt and no results list for an empty query", () => {
    renderView({ query: "" });
    expect(screen.getByText(/type to search/i)).toBeDefined();
    expect(document.querySelector('[role="option"]')).toBeNull();
  });
});

/**
 * The keyboard hand-off between the input and the results list (BACKLOG #12).
 *
 * These could not be written under jsdom. Programmatically focusing a React Aria ListBox option
 * drives its roving-tabindex/collection machinery, which needs layout APIs jsdom doesn't implement
 * and throws — so the behavior was documented as "verified in the E2E layer", and then wasn't: no
 * E2E test ever pressed ArrowDown. What stood in for it here was a test asserting the searchbox
 * EXISTS, which passes whether or not any key does anything.
 *
 * Running components in a real browser is what makes them expressible, so they are here now, at the
 * layer that can say WHICH key moved focus WHERE.
 */
describe("search results keyboard hand-off", () => {
  const firstOption = (): HTMLElement => {
    const option = document.querySelector<HTMLElement>('[role="option"]');
    if (!option) throw new Error("no result options rendered");
    return option;
  };

  it("moves focus from the input into the first result on ArrowDown", async () => {
    // WHY: this is the whole point of #12 — reaching results without touching the mouse. If the
    // handler stops firing, focus stays in the input and the list is keyboard-unreachable.
    renderView();
    await screen.findByText("食べる");
    const input = screen.getByRole("searchbox");
    input.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(firstOption());
  });

  it("returns focus to the input on Escape from the list", async () => {
    // WHY: Escape is the escape hatch. Without it, a user who arrows into results has no keyboard
    // route back to editing their query.
    renderView();
    await screen.findByText("食べる");
    const input = screen.getByRole("searchbox");
    input.focus();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(input);
  });

  it("returns to the input on ArrowUp only from the FIRST option", async () => {
    // WHY: the guard is the subtle half. Intercepting ArrowUp unconditionally would break moving UP
    // within the list — every ↑ would jump back to the input instead of to the previous result. So
    // assert both halves: from option two, ↑ stays in the list; from option one, ↑ leaves it.
    renderView();
    await screen.findByText("食べる");
    screen.getByRole("searchbox").focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).not.toBe(firstOption());

    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(firstOption());

    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });
});

describe("breakdown filter (#16)", () => {
  // A two-content-word sentence, which is what makes the host emit segments at all. 食べる matches
  // one of the mocked results by headword; 食う matches the other.
  const sentence: SegmentDto[] = [
    { surface: "食べる", lemma: "食べる", reading: "タベル", pos: "verb" },
    { surface: "や", lemma: "や", reading: "ヤ", pos: "particle" },
    { surface: "食う", lemma: "食う", reading: "クウ", pos: "verb" }
  ];

  // The mock's segments are module-level and mutable, so hand them back rather than leaving the
  // breakdown bar rendered for every other spec in this file.
  afterEach(() => {
    segments.current = [];
  });

  // Assert against the RESULT rows, not raw text: with the bar rendered, every headword also
  // appears as a chip, so `getByText("食う")` matches both and cannot tell them apart.
  const headwords = (): string[] =>
    [...document.querySelectorAll('[role="option"]')].map(
      (o) => o.textContent ?? ""
    );

  it("shows every result when no chip is selected", async () => {
    // WHY: the baseline the filter is measured against — an unselected bar must not narrow
    // anything, or the breakdown would silently hide results just by appearing.
    segments.current = sentence;
    renderView({ selectedSegment: null });
    await screen.findAllByText("食べる");
    expect(headwords()).toHaveLength(2);
  });

  it("narrows the results to the selected chip's word", async () => {
    // WHY: this IS the feature. Selecting 食べる must leave 食べる and drop 食う — filtering the
    // sentence in place, where the old behaviour re-searched and destroyed the sentence entirely.
    segments.current = sentence;
    renderView({ selectedSegment: 0 });
    await screen.findAllByText("食べる");
    const shown = headwords();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("食べる");
  });

  it("leaves the results alone when the selection is past the end", async () => {
    // WHY: the index is restored from a previous session and is only meaningful against the current
    // query's segments. A stale index must degrade to "no filter", not to an empty list the user
    // cannot explain or clear.
    segments.current = sentence;
    renderView({ selectedSegment: 99 });
    await screen.findAllByText("食べる");
    expect(headwords()).toHaveLength(2);
  });
});

describe("full match vs partial matches", () => {
  const sentence: SegmentDto[] = [
    { surface: "食べる", lemma: "食べる", reading: "タベル", pos: "verb" },
    { surface: "や", lemma: "や", reading: "ヤ", pos: "particle" },
    { surface: "食う", lemma: "食う", reading: "クウ", pos: "verb" }
  ];

  afterEach(() => {
    segments.current = [];
    results.current = null;
  });

  it("labels the results of a multi-word query as partial matches", async () => {
    // WHY (Shirabe reference): searching a sentence returns fragments of what was typed, and a flat
    // unlabelled list says nothing about what they are. The header is the whole point.
    segments.current = sentence;
    renderView({ query: "食べるや食う" });
    await screen.findAllByText("食べる");
    expect(screen.getByText("Partial matches")).toBeDefined();
  });

  it("does NOT label a plain single-word lookup", async () => {
    // WHY: 食べる already puts its exact match first by ranking, and calling the rest "partial
    // matches" would add a header to every ordinary search. The section is for sentences only —
    // which is exactly when the host emits segments.
    renderView({ query: "食べる" });
    await screen.findAllByText("食べる");
    expect(screen.queryByText("Partial matches")).toBeNull();
  });

  it("lifts the whole-query entry out of the list when the sentence IS a word", async () => {
    // WHY: 申し訳ございません is both a dictionary entry and something the tokenizer breaks up, so it
    // must appear ONCE as the answer rather than buried among its own fragments.
    segments.current = sentence;
    results.current = [
      {
        id: "whole",
        headword: "申し訳ございません",
        reading: "もうしわけございません",
        common: true,
        glossPreview: "I'm sorry",
        jlpt: null
      },
      {
        id: "part",
        headword: "申し訳",
        reading: "もうしわけ",
        common: true,
        glossPreview: "apology",
        jlpt: null
      }
    ];
    renderView({ query: "申し訳ございません" });
    await screen.findAllByText("申し訳ございません");

    // The full match is its own list, and the fragment is under the labelled one.
    const full = screen.getByRole("listbox", { name: "Full match" });
    expect(full.textContent).toContain("申し訳ございません");
    const partial = screen.getByRole("listbox", { name: "Partial matches" });
    expect(partial.textContent).toContain("申し訳");
    // Not duplicated into both.
    expect(partial.textContent).not.toContain("申し訳ございません");
  });

  it("shows only partial matches when the sentence is not itself a word", async () => {
    // WHY: 毎日日本語を勉強します has no entry of its own, so there is nothing to feature — the second
    // Shirabe screenshot has no full-match section at all.
    segments.current = sentence;
    renderView({ query: "毎日日本語を勉強します" });
    await screen.findAllByText("食べる");
    expect(screen.queryByRole("listbox", { name: "Full match" })).toBeNull();
    expect(screen.getByText("Partial matches")).toBeDefined();
  });
});
