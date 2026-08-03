import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderWithNavigation as render } from "../../__tests__/navigationHarness";
import type { NavEvent } from "../../machines/navigation";
import { SearchResults } from "../SearchResults";
import type { SearchResultDto } from "../../../shared/messages";

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
  // The recent-search history round-trips through the host; these stubs keep it inert so these
  // tests stay about the results list.
  recordRecentSearch: vi.fn<() => Promise<{ recent: [] }>>(async () => ({
    recent: []
  })),
  clearRecentSearches: vi.fn<() => Promise<{ recent: [] }>>(async () => ({
    recent: []
  }))
}));

vi.mock("../../queries", () => ({
  searchQuery: (query: string) => ({
    queryKey: ["search", query],
    queryFn: () => ({ words, kanji: [], segments: [] }),
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
  return render(wrapper(<SearchResults query="食べる" {...props} />)).sent;
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
