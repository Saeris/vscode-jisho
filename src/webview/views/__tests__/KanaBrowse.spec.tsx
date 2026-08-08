import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithNavigation as render } from "../../__tests__/navigationHarness";
import { KanaBrowse } from "../KanaBrowse";

describe("kana browse", () => {
  it("renders the chart in hiragana, and switches the whole chart to katakana", () => {
    // WHY (#55 step 3): katakana is DERIVED by codepoint rather than stored, so the toggle is the
    // only place a user can see that derivation land. Checking a cell from EACH section — base,
    // voiced, digraph — is what catches a conversion that works on plain kana but drops the small
    // kana of a digraph (キゃ rather than キャ).
    render(<KanaBrowse />);
    expect(screen.getByText("し")).toBeDefined();
    expect(screen.getByText("ぱ")).toBeDefined();
    expect(screen.getByText("きゃ")).toBeDefined();

    fireEvent.click(screen.getByRole("radio", { name: "Katakana" }));
    expect(screen.getByText("シ")).toBeDefined();
    expect(screen.getByText("パ")).toBeDefined();
    expect(screen.getByText("キャ")).toBeDefined();
    expect(screen.queryByText("し")).toBeNull();
  });

  it("opens stroke order for the kana that is displayed, not the stored one", () => {
    // WHY: tapping a kana opens how it is WRITTEN — a single syllable is not a word, so searching
    // one answers nothing. The cell's key stays hiragana across the toggle so its identity
    // survives, but a user tapping シ means シ; opening the key would show the hiragana drawing
    // from the katakana chart, a bug invisible on the hiragana side where the forms coincide.
    const { sent } = render(<KanaBrowse />);
    fireEvent.click(screen.getByText("し"));
    expect(sent).toContainEqual({ type: "openStrokeOrder", literal: "し" });

    fireEvent.click(screen.getByRole("radio", { name: "Katakana" }));
    fireEvent.click(screen.getByText("シ"));
    expect(sent).toContainEqual({ type: "openStrokeOrder", literal: "シ" });
  });

  it("does not act on a digraph, which has no drawing", () => {
    // WHY: きゃ is two code points and a drawing is served by one-code-point filename — upstream
    // has no combined file either. Without disabling them a tap would push an empty stroke-order
    // page, which reads as a broken feature rather than an absent one.
    const { sent } = render(<KanaBrowse />);
    fireEvent.click(screen.getByText("きゃ"));
    expect(sent).toEqual([]);
  });

  it("dims the obsolete kana but keeps them tappable", () => {
    // WHY: ゐ/ゑ are dimmed because you will not meet them in modern text — but they DO have stroke
    // drawings, and someone meeting one in historical text is exactly who needs to look it up. The
    // dimming is a statement about usage, not a reason to make the cell dead.
    const { sent } = render(<KanaBrowse />);
    fireEvent.click(screen.getByText("ゐ"));
    expect(sent).toContainEqual({ type: "openStrokeOrder", literal: "ゐ" });
  });

  it("leaves the chart's gaps out of the collection entirely", () => {
    // WHY: や has no yi/ye and わ no wu. Rendering those as disabled cells would make a screen
    // reader announce blanks while crossing the row — describing our layout rather than the
    // language — so the gaps are empty grid space and the option count is exactly the real kana.
    render(<KanaBrowse />);
    expect(screen.getAllByRole("option")).toHaveLength(48 + 25 + 33);
  });
});
