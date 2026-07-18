// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
// acquireVsCodeApi at load, which jsdom doesn't have.
vi.mock("../../bridge", () => ({
  openSettings: vi.fn<() => Promise<void>>(async () => undefined)
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
  })
}));

const renderView = (
  props?: Partial<Parameters<typeof SearchResults>[0]>
): void => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  render(
    wrapper(
      <SearchResults
        query="食べる"
        onQueryChange={() => {}}
        onOpenWord={() => {}}
        onOpenKanji={() => {}}
        onOpenName={() => {}}
        onOpenRadicals={() => {}}
        onOpenHandwriting={() => {}}
        onOpenAbout={() => {}}
        {...props}
      />
    )
  );
};

// jsdom scope note: the keyboard-navigation hand-off (BACKLOG #12 — ↓ from the input into the
// results, ↑/Esc back) is a **React Aria ListBox focus-integration** behavior. Programmatically
// focusing a ListBox option triggers React Aria's roving-tabindex/collection machinery, which needs
// layout APIs jsdom doesn't implement and throws (sync and on later ticks). So that behavior is
// verified in the E2E (real-browser) layer, not here. These jsdom tests cover what renders reliably:
// result rendering, the query→results wiring, and empty state.
describe("search results (rendering + query wiring)", () => {
  afterEach(cleanup);

  it("renders word results with their headwords and readings", async () => {
    renderView();
    await expect(screen.findByText("食べる")).resolves.toBeDefined();
    expect(screen.getByText("食う")).toBeDefined();
    expect(screen.getByText("たべる")).toBeDefined();
  });

  it("exposes the search input as a searchbox (the keyboard-nav target)", async () => {
    renderView();
    await screen.findByText("食べる");
    expect(screen.getByRole("searchbox")).toBeDefined();
  });

  it("shows a prompt and no results list for an empty query", () => {
    renderView({ query: "" });
    expect(screen.getByText(/type to search/i)).toBeDefined();
    expect(document.querySelector('[role="option"]')).toBeNull();
  });
});
