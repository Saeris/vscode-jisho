// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { KanjiDetail } from "../KanjiDetail";
import type { KanjiDetailDto } from "../../../shared/messages";

// 久 as Kradfile actually decomposes it: 入 and 久 are real kanji, ノ is a stroke-shape proxy with
// no Kanjidic entry. Mocked so the test is about the routing decision, not the host round-trip.
const kanji: KanjiDetailDto = {
  literal: "久",
  grade: 5,
  strokeCount: 3,
  frequency: 933,
  jlpt: 2,
  on: ["キュウ", "ク"],
  kun: ["ひさ.しい"],
  meanings: ["long time", "old story"],
  nanori: [],
  components: [
    { literal: "ノ", hasDetail: false },
    { literal: "久", hasDetail: true },
    { literal: "入", hasDetail: true }
  ],
  hasTree: false,
  words: []
};

vi.mock("../../queries", () => ({
  kanjiQuery: (literal: string) => ({
    queryKey: ["kanji", literal],
    queryFn: () => kanji
  }),
  strokeSvgQuery: (literal: string) => ({
    queryKey: ["strokeSvg", literal],
    queryFn: () => null
  })
}));

const renderView = (
  props?: Partial<Parameters<typeof KanjiDetail>[0]>
): void => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  render(
    wrapper(
      <KanjiDetail
        literal="久"
        onBack={vi.fn<() => void>()}
        onOpenKanji={vi.fn<(literal: string) => void>()}
        onOpenWord={vi.fn<(id: string) => void>()}
        onOpenStrokeOrder={vi.fn<(literal: string) => void>()}
        onOpenComponentTree={vi.fn<(literal: string) => void>()}
        onFindByPart={vi.fn<(parts: string[]) => void>()}
        {...props}
      />
    )
  );
};

describe("kanji detail parts", () => {
  afterEach(cleanup);

  it("opens the kanji detail for a part that is a real kanji", async () => {
    // WHY: the common case must keep working — drilling 久 → 入 is the whole point of the parts list.
    const onOpenKanji = vi.fn<(literal: string) => void>();
    renderView({ onOpenKanji });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open 入" })
    );
    expect(onOpenKanji).toHaveBeenCalledWith("入");
  });

  it("sends a part with no kanji entry to the radical picker instead", async () => {
    // WHY: this is the bug. Tapping ノ used to call openKanji, and Kanjidic has no ノ, so the user
    // hit a "Kanji not found" dead end. ノ is a real part (1,415 kanji contain it) — Kradfile just
    // borrows the katakana glyph because the true radical 丿 isn't JIS X 0208-encodable. The
    // meaningful question "what is built from this part?" is the radical picker's, so route there.
    const onFindByPart = vi.fn<(parts: string[]) => void>();
    const onOpenKanji = vi.fn<(literal: string) => void>();
    renderView({ onFindByPart, onOpenKanji });
    await userEvent.click(
      await screen.findByRole("button", { name: "Find kanji containing ノ" })
    );
    expect(onFindByPart).toHaveBeenCalledWith(["ノ"]);
    // Crucially it must NOT try to open a detail page that cannot exist.
    expect(onOpenKanji).not.toHaveBeenCalled();
  });

  it("keeps every part tappable", async () => {
    // WHY: hiding or disabling the proxies would erase real structural information about the
    // character (ノ genuinely is part of 久). Jisho links all parts too — the destination differs,
    // the affordance doesn't.
    renderView();
    for (const label of ["Find kanji containing ノ", "Open 久", "Open 入"]) {
      await expect(
        screen.findByRole("button", { name: label })
      ).resolves.toBeDefined();
    }
  });
});
