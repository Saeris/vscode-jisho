// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SegmentBar } from "../SegmentBar";
import type { SegmentDto } from "../../../shared/messages";

// 日本語を勉強します → 日本語[noun] を[particle] 勉強します[verb], where the verb's surface differs
// from its lemma (勉強します vs 勉強する) — the chip shows the surface but searches the lemma.
const segments: SegmentDto[] = [
  { surface: "日本語", lemma: "日本語", reading: "ニホンゴ", pos: "noun" },
  { surface: "を", lemma: "を", reading: "ヲ", pos: "particle" },
  {
    surface: "勉強します",
    lemma: "勉強する",
    reading: "ベンキョウ",
    pos: "verb"
  }
];

describe("segment bar", () => {
  afterEach(cleanup);

  it("renders content words as tappable chips and particles as inert text", () => {
    // WHY: the whole affordance is "content words are clickable, particles aren't" — a particle
    // rendered as a button would mislead the user into a pointless search.
    render(<SegmentBar segments={segments} onSelectSegment={() => {}} />);
    expect(screen.getByRole("button", { name: /日本語/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /勉強する/ })).toBeDefined();
    // The particle を is present as text but NOT a button.
    expect(screen.getByText("を")).toBeDefined();
    expect(screen.queryByRole("button", { name: /を/ })).toBeNull();
  });

  it("searches a chip's LEMMA, not its inflected surface", () => {
    // WHY: tapping 勉強します must search 勉強する (the dictionary form), or the user gets no result
    // for the conjugated surface. This is the M5 tokenizer's payoff surfacing in the UI.
    const onSelect = vi.fn<(lemma: string) => void>();
    render(<SegmentBar segments={segments} onSelectSegment={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /勉強する/ }));
    expect(onSelect).toHaveBeenCalledWith("勉強する");
  });

  it("tags content chips with their part of speech for theme-aware coloring", () => {
    // WHY: POS coloring (via data-pos → CVA/CSS) is how the breakdown reads at a glance; a missing
    // data-pos would drop the color cue.
    render(<SegmentBar segments={segments} onSelectSegment={() => {}} />);
    const noun = screen.getByRole("button", { name: /日本語/ });
    const verb = screen.getByRole("button", { name: /勉強する/ });
    expect(noun.getAttribute("data-pos")).toBe("noun");
    expect(verb.getAttribute("data-pos")).toBe("verb");
  });
});
