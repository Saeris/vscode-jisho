import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderWithNavigation as render } from "../../__tests__/navigationHarness";
import type { NavEvent } from "../../machines/navigation";
import { KanjiDetail } from "../KanjiDetail";
import type {
  KanjiDetailDto,
  RegionalGroupDto
} from "../../../shared/messages";

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
  similar: [
    { literal: "夂", meaning: "winter" },
    { literal: "父", meaning: "father" }
  ],
  hasTree: false,
  words: []
};

// 学, for the page's links: a component tree, and regions that write it differently.
const learn: KanjiDetailDto = {
  ...kanji,
  literal: "学",
  components: [],
  similar: [],
  hasTree: true
};
const learnGroup: RegionalGroupDto = {
  key: "學",
  chars: ["学", "學", "學", "学"],
  old: "學",
  glyphSig: "01101",
  cpSig: "0110",
  strokes: [8, 16, 16, 8, 16],
  tiers: [1, 1, 1, 2],
  readings: [null, null, null, null],
  ranks: [null, null, null, null],
  notes: [],
  meanings: [],
  japaneseMeanings: [],
  kanjiLinks: []
};

vi.mock("../../queries", () => ({
  kanjiQuery: (literal: string) => ({
    queryKey: ["kanji", literal],
    queryFn: () => (literal === "学" ? learn : kanji)
  }),
  strokeSvgQuery: (literal: string) => ({
    queryKey: ["strokeSvg", literal],
    queryFn: () => null
  }),
  // The page also asks for regional forms (spec 22); RegionalSummary.spec.tsx covers that block,
  // and the links test below where it sits.
  regionalFormsQuery: (literal: string) => ({
    queryKey: ["regionalForms", literal],
    queryFn: () => (literal === "学" ? [learnGroup] : [])
  })
}));

/** Render the view and return the navigation events it dispatched. */
const renderView = (literal = "久"): NavEvent[] => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  // Navigation now comes from context, so assertions are on the EVENTS the view dispatches rather
  // than on which callback prop fired — which is closer to what the user experiences anyway.
  return render(wrapper(<KanjiDetail literal={literal} />)).sent;
};

describe("kanji detail links", () => {
  it("lists Regional forms third, after Stroke order and Component tree", async () => {
    // WHY: the links go from the kanji itself outward: how to write it, what it is built from, and
    // then how other regions write it. Regional forms used to sit above the two about the kanji.
    renderView("学");
    const regional = await screen.findByRole("button", {
      name: /^Regional forms/u
    });
    const stroke = screen.getByRole("button", { name: "Stroke order" });
    const tree = screen.getByRole("button", { name: "Component tree" });
    const follows = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(stroke, tree)).toBe(true);
    expect(follows(tree, regional)).toBe(true);
  });
});

describe("kanji detail parts", () => {
  it("opens the kanji detail for a part that is a real kanji", async () => {
    // WHY: the common case must keep working — drilling 久 → 入 is the whole point of the parts list.
    const sent = renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open 入" })
    );
    expect(sent).toContainEqual({ type: "openKanji", literal: "入" });
  });

  it("sends a part with no kanji entry to the radical picker instead", async () => {
    // WHY: this is the bug. Tapping ノ used to call openKanji, and Kanjidic has no ノ, so the user
    // hit a "Kanji not found" dead end. ノ is a real part (1,415 kanji contain it) — Kradfile just
    // borrows the katakana glyph because the true radical 丿 isn't JIS X 0208-encodable. The
    // meaningful question "what is built from this part?" is the radical picker's, so route there.
    const sent = renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Find kanji containing ノ" })
    );
    expect(sent).toContainEqual({ type: "openRadicals", preselect: ["ノ"] });
    // Crucially it must NOT try to open a detail page that cannot exist.
    expect(sent).not.toContainEqual({ type: "openKanji", literal: "ノ" });
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

  it("renders similar kanji with meanings, each opening its detail (F3)", async () => {
    // WHY: the similar-kanji section is the F3 payoff — each look-alike is a tile carrying a short
    // meaning (so the row reads as "look alike, mean different things") and opens that kanji's page.
    // The accessible name pairs literal + meaning so a screen reader announces both.
    const sent = renderView();
    await expect(
      screen.findByRole("heading", { name: "Similar kanji" })
    ).resolves.toBeDefined();
    // The meaning shows on the tile.
    await expect(screen.findByText("winter")).resolves.toBeDefined();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open 夂 (winter)" })
    );
    expect(sent).toContainEqual({ type: "openKanji", literal: "夂" });
  });
});
