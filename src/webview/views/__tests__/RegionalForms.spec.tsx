import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { RegionalGroupDto } from "../../../shared/messages";
import { renderWithNavigation } from "../../__tests__/navigationHarness";
import { RegionalForms } from "../RegionalForms";

// As the built database returns them (db.spec.ts checks 学 against the real data).
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
      readings: ["xué", "hok6", "xué", "ガク、まな.ぶ"],
      ranks: [66, 84, 93, 5]
    }
  ],
  園: [
    {
      key: "園",
      chars: ["园", "園", "園", "園"],
      glyphSig: "0112",
      cpSig: "0111",
      strokes: [7, 13, 13, 13],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null]
    }
  ],
  返: [
    {
      key: "返",
      chars: ["返", "返", "返", "返"],
      glyphSig: "0123",
      cpSig: "0000",
      strokes: [7, 7, 8, 7],
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

const renderView = (literal: string): void => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrap = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  renderWithNavigation(wrap(<RegionalForms literal={literal} />));
};

/** Stand in for the reader's motion preference. */
const prefersReducedMotion = (reduce: boolean): void => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }) as unknown as MediaQueryList
  );
};

describe("the Regional forms view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("describes the overprint in words: each form and who writes it", async () => {
    // WHY: the overprint tells forms apart by ink alone; a reader who cannot see the inks, or
    // cannot tell the hues apart, needs the same information as text.
    renderView("学");
    await expect(
      screen.findByRole("img", {
        name: "Overlaid: 学 (China and Japan), 學 (Hong Kong, Taiwan and Japan's old form)"
      })
    ).resolves.toBeVisible();
  });

  it("labels every form with its regions when set side by side", async () => {
    // WHY: Separate is how a reader checks which shape belongs to whom without relying on colour.
    prefersReducedMotion(false);
    renderView("学");
    await userEvent.click(
      await screen.findByRole("radio", { name: "Separate" })
    );
    const forms = await screen.findByRole("img", { name: /^Side by side/u });
    expect(forms.textContent).toContain(
      "學Hong Kong, Taiwan and Japan's old form"
    );
  });

  it("switches modes without animating when the reader asks for less motion", async () => {
    // WHY: the layers sliding into place is motion; with reduced motion the switch is a plain one.
    prefersReducedMotion(true);
    const transition = vi.spyOn(document, "startViewTransition");
    renderView("学");
    await userEvent.click(
      await screen.findByRole("radio", { name: "Separate" })
    );
    expect(transition).not.toHaveBeenCalled();
    await expect(
      screen.findByRole("img", { name: /^Side by side/u })
    ).resolves.toBeVisible();
  });

  it("says when every form is one code point drawn differently", async () => {
    // WHY: 返 is one code point in all four regions; without saying so, the chart's four identical
    // code points would tell the reader the regions write it alike. Once for the group, not per row.
    renderView("返");
    await expect(
      screen.findByText("4 forms of one code point, U+8FD4")
    ).resolves.toBeVisible();
    expect(
      screen.queryByText(
        "Same code point as another form here, drawn differently"
      )
    ).toBeNull();
    // Taiwan's official count, not Unihan's.
    expect(screen.getByText("U+8FD4 · 8 strokes")).toBeVisible();
  });

  it("marks only the forms that share a code point when the others differ", async () => {
    // WHY: Hong Kong, Taiwan and Japan all write U+5712, Japan drawing it its own way, while China
    // writes 园: the note must sit on the two rows it is true of, not on China's.
    renderView("園");
    await expect(
      screen.findAllByText(
        "Same code point as another form here, drawn differently"
      )
    ).resolves.toHaveLength(2);
    expect(screen.getByText("3 forms")).toBeVisible();
  });

  it("gives each region's reading and its rank in that region's corpus", async () => {
    // WHY: phase 5's point: Mandarin and Cantonese beside Japan's readings, and four ranks that
    // each name their corpus, since #66 in China and #5 in Japan count different texts.
    renderView("学");
    const section = (await screen.findByText("Readings and frequency"))
      .nextElementSibling;
    expect(section?.textContent).toContain(
      "China 学xué (Mandarin)#66 in modern Chinese texts"
    );
    expect(section?.textContent).toContain(
      "Hong Kong 學hok6 (Cantonese)#84 in Cantonese texts (words.hk)"
    );
    expect(section?.textContent).toContain(
      "#93 in news and social media (2023)"
    );
    expect(section?.textContent).toContain(
      "ガク、まな.ぶ (Japanese)#5 on Japanese Wikipedia"
    );
  });

  it("pulls the layers apart while dragged, and lets them go on release", async () => {
    // WHY: dragging is how a reader separates the forms by hand; the layers must follow the
    // pointer, and come back into register, or the stack stays split and unreadable.
    renderView("学");
    const stack = (await screen.findByRole("img")).closest("figure");
    if (!stack) throw new Error("no overprint");
    fireEvent.pointerDown(stack, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(stack, { clientX: 112, pointerId: 1 });
    expect(stack.style.getPropertyValue("--overprint-pull")).toBe("12px");
    expect(stack).toHaveAttribute("data-dragging");
    fireEvent.pointerUp(stack, { pointerId: 1 });
    expect(stack.style.getPropertyValue("--overprint-pull")).toBe("0px");
    expect(stack).not.toHaveAttribute("data-dragging");
  });
});
