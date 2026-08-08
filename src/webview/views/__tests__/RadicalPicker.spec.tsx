import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderWithNavigation as render } from "../../__tests__/navigationHarness";
import { RadicalPicker } from "../RadicalPicker";
import type { RadicalLookupDto } from "../../../shared/messages";

// 目 selected, with two kanji that contain it. Real meanings, because what this spec is about is
// that the meaning REACHES the screen — a placeholder would pass while showing nothing useful.
const lookup: RadicalLookupDto = {
  radicals: [
    { radical: "目", strokeCount: 5, position: null },
    { radical: "貝", strokeCount: 7, position: null }
  ],
  enabled: ["目", "貝"],
  matches: [
    {
      literal: "眠",
      strokeCount: 10,
      grade: 8,
      jlpt: 2,
      meaningPreview: "sleep, die, sleepy",
      onPreview: "ミン",
      kunPreview: "ねむ.る"
    },
    {
      literal: "睡",
      strokeCount: 13,
      grade: 8,
      jlpt: 1,
      meaningPreview: "drowsy, sleep",
      onPreview: "スイ",
      kunPreview: ""
    }
  ]
};

vi.mock("../../queries", () => ({
  radicalQuery: (selected: string[]) => ({
    queryKey: ["radicals", selected],
    queryFn: () => lookup
  })
}));

const renderView = (): void => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  render(
    wrapper(
      <RadicalPicker
        onBack={vi.fn<() => void>()}
        onOpenKanji={vi.fn<(literal: string) => void>()}
        preselect={["目"]}
      />
    )
  );
};

describe("radical picker matches", () => {
  it("shows each match's meaning, not just the bare character", async () => {
    // WHY: the meaning was already on the wire (KanjiResultDto.meaningPreview) and already in the
    // aria-label, but the tile rendered the glyph alone — so a sighted user faced a wall of
    // characters and had to open each one to learn what it was. The list is only scannable if the
    // meaning is VISIBLE, which an aria-label assertion would not catch.
    renderView();
    await expect(
      screen.findByText("sleep, die, sleepy")
    ).resolves.toBeDefined();
    expect(screen.getByText("drowsy, sleep")).toBeDefined();
  });

  it("still opens the kanji when a match is picked", async () => {
    // The tile gained a child span per match; clicking now lands on the inner text rather than the
    // button itself, so this guards that the press still reaches the button's handler.
    const onOpenKanji = vi.fn<(literal: string) => void>();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    render(
      <QueryClientProvider client={client}>
        <RadicalPicker
          onBack={vi.fn<() => void>()}
          onOpenKanji={onOpenKanji}
          preselect={["目"]}
        />
      </QueryClientProvider>
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Open 眠/ })
    );
    expect(onOpenKanji).toHaveBeenCalledWith("眠");
  });
});
