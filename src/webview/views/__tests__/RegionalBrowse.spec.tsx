import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { RegionalGroupDto } from "../../../shared/messages";
import { renderWithNavigation } from "../../__tests__/navigationHarness";
import { RegionalBrowse } from "../RegionalBrowse";

const group = (
  fields: Partial<RegionalGroupDto> & Pick<RegionalGroupDto, "key" | "chars">
): RegionalGroupDto => ({
  glyphSig: "0000",
  cpSig: "0000",
  strokes: [null, null, null, null],
  tiers: [1, 1, 1, 1],
  readings: [null, null, null, null],
  ranks: [null, null, null, null],
  notes: [],
  ...fields
});

// As the built database has them (db.spec.ts checks the real list).
const SMALL = [
  group({
    key: "學",
    chars: ["学", "學", "學", "学"],
    old: "學",
    glyphSig: "01101",
    strokes: [8, 16, 16, 8, 16],
    readings: ["xué", "hok6", "xué", "ガク"],
    ranks: [66, 84, 93, 5]
  }),
  group({
    key: "山",
    chars: ["山", "山", "山", "山"],
    glyphSig: "0001",
    strokes: [3, 3, 3, 3],
    readings: ["shān", "saan1", "shān", "サン"],
    ranks: [200, 150, 180, 30]
  }),
  group({
    key: "返",
    chars: ["返", "返", "返", "返"],
    glyphSig: "0123",
    strokes: [7, 7, 8, 7],
    readings: ["fǎn", "faan2", "fǎn", "ヘン"],
    ranks: [1000, 900, 800, 400]
  })
];

/** As many groups as the real table holds, one code point each from 一 on. */
const MANY = Array.from({ length: 8000 }, (_, index) => {
  const char = String.fromCodePoint(0x4e00 + index);
  return group({ key: char, chars: [char, char, char, char] });
});

let groups: RegionalGroupDto[] = SMALL;
vi.mock("../../queries", () => ({
  regionalBrowseQuery: () => ({
    queryKey: ["regionalBrowse"],
    queryFn: () => groups
  })
}));

// The sidebar's column: the list fills what the filters leave, as in the Kanji tab.
const renderList = (
  data: RegionalGroupDto[]
): ReturnType<typeof renderWithNavigation> => {
  groups = data;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrap = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>
      <div
        style={{ display: "flex", flexDirection: "column", height: "600px" }}
      >
        {ui}
      </div>
    </QueryClientProvider>
  );
  return renderWithNavigation(wrap(<RegionalBrowse onRoot={() => {}} />));
};

const list = async (): Promise<HTMLElement> =>
  screen.findByRole("listbox", { name: "Regional differences" });

describe("the Regional differences list", () => {
  it("renders only the rows in view, out of a table as large as the real one", async () => {
    // WHY: the table has 8,418 groups, each row an overprint of up to five forms in custom fonts.
    // Rendering all of them would make every filter change slow; the list must stay fast.
    renderList(MANY);
    await expect(screen.findByText("8,000 characters")).resolves.toBeVisible();
    const options = within(await list()).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThan(60);
  });

  it("filters to one exact split, and each row shows the value it is sorted by", async () => {
    // WHY: the split is phase 7's main filter. And the rows are cached by React Aria, so a row
    // that kept showing a frequency rank after the sort changed to strokes would contradict the
    // order beside it.
    renderList(SMALL);
    await list();
    await userEvent.click(screen.getByRole("button", { name: /^Filters/u }));
    await userEvent.click(screen.getByRole("radio", { name: "Two forms" }));
    await userEvent.click(
      screen.getByRole("radio", { name: "Japan alone differs" })
    );
    await expect(screen.findByText("1 character")).resolves.toBeVisible();
    const row = within(await list()).getByRole("option");
    expect(row).toHaveAccessibleName(
      "山, Japan; 山, China, Hong Kong and Taiwan"
    );
    expect(row.textContent).toContain("#30");
    await userEvent.click(screen.getByRole("radio", { name: "Strokes" }));
    await vi.waitFor(() => {
      expect(within(row).getByText("3 strokes")).toBeVisible();
    });
  });

  it("finds a group by a reading typed without tone marks", async () => {
    renderList(SMALL);
    await list();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search the regional forms" }),
      "xue"
    );
    await expect(screen.findByText("1 character")).resolves.toBeVisible();
    expect(within(await list()).getByRole("option")).toHaveAccessibleName(
      "学, China and Japan; 學, Hong Kong, Taiwan and Japan's old form"
    );
  });

  it("opens the Regional forms view for the row's Japanese form", async () => {
    // WHY: the view is keyed by Japan's form; opening it by the group's name (學) would land on a
    // page that shows 學 only as an old form.
    const { sent } = renderList(SMALL);
    await userEvent.click(
      within(await list()).getByRole("option", {
        name: "学, China and Japan; 學, Hong Kong, Taiwan and Japan's old form"
      })
    );
    expect(sent).toContainEqual({ type: "openRegionalForms", literal: "学" });
  });
});

describe("the stroke range", () => {
  it("starts over when the region changes", async () => {
    // WHY: a range is set in one region's counts (返 is 7 strokes in Japan, 8 in Taiwan); carried
    // over to another region it would quietly filter by numbers the reader never chose for it.
    // Japan's counts here run to 8 (学); Taiwan's to 16 (學).
    renderList(SMALL);
    await list();
    await userEvent.click(screen.getByRole("button", { name: /^Filters/u }));
    const fewest = screen.getByRole("slider", { name: /Fewest strokes/u });
    fewest.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect(screen.findByText("3–8")).resolves.toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "Taiwan" }));
    await expect(screen.findByText("Strokes in Taiwan")).resolves.toBeVisible();
    expect(screen.getByText("1–16")).toBeVisible();
  });
});
