import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { RegionalGroupDto } from "../../../shared/messages";
import { RegionalSummary } from "../RegionalSummary";

// Groups as the built database returns them (db.spec.ts checks 学 and 予 against the real data).
const GROUPS: Record<string, RegionalGroupDto[]> = {
  学: [
    {
      key: "學",
      chars: ["学", "學", "學", "学"],
      old: "學",
      glyphSig: "01101",
      cpSig: "0110",
      strokes: [8, 16, 16, 8, 16],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null]
    }
  ],
  一: [
    {
      key: "一",
      chars: ["一", "一", "一", "一"],
      glyphSig: "0000",
      cpSig: "0000",
      strokes: [1, 1, 1, 1],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null]
    }
  ],
  研: [
    {
      key: "研",
      chars: ["研", "研", "研", "研"],
      old: "硏",
      glyphSig: "00001",
      cpSig: "0000",
      strokes: [9, 9, 9, 9, 11],
      tiers: [1, 1, 1, 1],
      readings: [null, null, null, null],
      ranks: [null, null, null, null]
    }
  ],
  予: [
    {
      key: "予",
      chars: ["予", "予", "予", "予"],
      glyphSig: "0000",
      cpSig: "0000",
      strokes: [4, 4, 4, 4],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null]
    },
    {
      key: "豫",
      chars: ["豫", "豫", "豫", "予"],
      old: "豫",
      glyphSig: "01123",
      cpSig: "0001",
      strokes: [15, 16, 16, 4, 16],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null]
    }
  ]
};

vi.mock("../../queries", () => ({
  regionalFormsQuery: (literal: string) => ({
    queryKey: ["regionalForms", literal],
    queryFn: () => GROUPS[literal] ?? []
  })
}));

const renderSummary = (literal: string): string[] => {
  const opened: string[] = [];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrap = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  render(
    wrap(<RegionalSummary literal={literal} onOpen={(l) => opened.push(l)} />)
  );
  return opened;
};

describe("the kanji page's regional forms", () => {
  it("says who writes the kanji differently, and opens the full view", async () => {
    // WHY: the block's one job is the answer from Japan's side (who writes 学 otherwise, how many
    // forms, the old form) and the way into the chart and overprint.
    const opened = renderSummary("学");
    const block = await screen.findByRole("button", {
      name: /Written differently in Hong Kong and Taiwan · 2 forms · old form 學/u
    });
    await userEvent.click(block);
    expect(opened).toEqual(["学"]);
  });

  it("says so in one quiet line when every region writes it alike", async () => {
    // WHY: most kanji look the same everywhere; a button into a chart of one form would waste a
    // tap and a row of the page.
    renderSummary("一");
    await expect(
      screen.findByText(
        "Written the same way in China, Hong Kong, Taiwan and Japan"
      )
    ).resolves.toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("still opens the view when only Japan's old form differs", async () => {
    // WHY: the four regions write 研 alike, but Japan wrote 硏 before its reform; that form is only
    // in the full view, so the quiet line would hide it.
    renderSummary("研");
    await expect(
      screen.findByRole("button", {
        name: /Written the same way in China, Hong Kong, Taiwan and Japan · old form 硏/u
      })
    ).resolves.toBeVisible();
  });

  it("names each character Japan writes alike", async () => {
    // WHY: 予 also stands for 豫; two unnamed lines would not say which character each describes.
    renderSummary("予");
    const block = await screen.findByRole("button");
    expect(block.textContent).toContain(
      "予Written the same way in China, Hong Kong, Taiwan and Japan"
    );
    expect(block.textContent).toContain(
      "豫Written differently in China, Hong Kong and Taiwan · 3 forms · old form 豫"
    );
  });

  it("shows nothing for a kanji outside the regions' lists", async () => {
    // WHY: the page must not grow an empty block, or jump when the answer arrives.
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <RegionalSummary literal="𠀋" onOpen={() => undefined} />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeEmptyDOMElement();
  });
});
