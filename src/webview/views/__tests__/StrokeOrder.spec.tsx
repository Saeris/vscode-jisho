import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { RegionalDrawingDto } from "../../../shared/messages";
import japanLearn from "../../../../assets/kanji-svgs/学.svg?raw";
import taiwanLearn from "../../../../assets/hant-svgs/學.svg?raw";
import japanBack from "../../../../assets/kanji-svgs/返.svg?raw";
import chinaBack from "../../../../assets/hans-svgs/返.svg?raw";
import { renderWithNavigation as render } from "../../__tests__/navigationHarness";
import { StrokeOrder } from "../StrokeOrder";

// As the host answers for 学 and 返 (src/host/__tests__/regionalStrokes.spec.ts covers how).
const REGIONAL: Record<string, RegionalDrawingDto[]> = {
  学: [
    { columns: [0, 3], char: "学", svg: japanLearn },
    { columns: [1, 2, 4], char: "學", svg: taiwanLearn }
  ],
  返: [
    { columns: [3], char: "返", svg: japanBack },
    { columns: [0], char: "返", svg: chinaBack },
    { columns: [1, 2], char: "返", svg: null }
  ],
  // Every region writes 水 alike, stroke for stroke: one drawing for all four.
  水: [{ columns: [0, 1, 2, 3], char: "水", svg: japanBack }]
};
const JAPANESE: Record<string, string> = {
  学: japanLearn,
  返: japanBack,
  水: japanBack
};

vi.mock("../../queries", () => ({
  strokeSvgQuery: (literal: string) => ({
    queryKey: ["strokeSvg", literal],
    queryFn: () => JAPANESE[literal] ?? null
  }),
  regionalStrokesQuery: (literal: string) => ({
    queryKey: ["regionalStrokes", literal],
    queryFn: () => REGIONAL[literal] ?? []
  }),
  kanjiQuery: (literal: string) => ({
    queryKey: ["kanji", literal],
    queryFn: () => null
  })
}));

const renderView = (literal: string): void => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrap = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  render(
    wrap(
      <StrokeOrder
        literal={literal}
        onOpenKanji={() => undefined}
        onFindByPart={() => undefined}
      />
    )
  );
};

/** The drawing the player shows, by its upstream id (`z<codepoint>`) and stroke count. */
const shownStrokes = async (): Promise<string> =>
  (await screen.findByText(/\d+ strokes/u)).textContent ?? "";

describe("stroke order by region", () => {
  it("offers each region's drawing, Japan's first, labelled by who writes it", async () => {
    // WHY: the reader compares orders by choosing whose to play; each choice must say which
    // regions it shows, and the page opens on Japan's, the dictionary's own.
    renderView("学");
    const choices = await screen.findAllByRole("radio");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "China and Japan",
      "Hong Kong, Taiwan and Japan's old form"
    ]);
    expect(choices[0]).toBeChecked();
    await expect(shownStrokes()).resolves.toContain("8 strokes");
  });

  it("plays Taiwan's drawing of 學 when chosen", async () => {
    // WHY: phase 4's point: 學 is drawn in Taiwan's own order, 16 strokes, not Japan's 学.
    renderView("学");
    await userEvent.click(
      await screen.findByRole("radio", {
        name: "Hong Kong, Taiwan and Japan's old form"
      })
    );
    await expect(shownStrokes()).resolves.toContain("16 strokes");
  });

  it("starts the new drawing from its first stroke", async () => {
    // WHY: the player's clock belongs to one drawing; carried over, a 16-stroke 學 would open at
    // whatever stroke 学 had reached, partly drawn.
    renderView("学");
    const slider = await screen.findByRole("slider");
    slider.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect(screen.findByText("2 / 8")).resolves.toBeVisible();
    await userEvent.click(
      screen.getByRole("radio", {
        name: "Hong Kong, Taiwan and Japan's old form"
      })
    );
    await expect(screen.findByText("0 / 16")).resolves.toBeVisible();
  });

  it("says plainly when a region's form has no drawing", async () => {
    // WHY: Taiwan's 返 is its own glyph and AnimCJK has no drawing of it; showing China's or
    // Japan's order there would hide the difference the reader came to check.
    renderView("返");
    await userEvent.click(
      await screen.findByRole("radio", { name: "Hong Kong and Taiwan" })
    );
    await expect(
      screen.findByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "There is no stroke-order drawing for 返 as Hong Kong and Taiwan write it."
      )
    ).resolves.toBeVisible();
    expect(screen.queryByText(/\d+ strokes/u)).toBeNull();
  });

  it("shows no choice for a kanji every region draws alike", async () => {
    // WHY: one drawing needs no switcher; offering one would suggest a difference there is not.
    renderView("水");
    await expect(shownStrokes()).resolves.toMatch(/strokes/u);
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
