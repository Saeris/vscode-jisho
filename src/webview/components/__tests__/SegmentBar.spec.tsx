import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentBar } from "../SegmentBar";
import type { SegmentDto } from "../../../shared/messages";

// 日本語を勉強します → 日本語[noun] を[particle] 勉強します[verb], where the verb's surface differs
// from its lemma (勉強します vs 勉強する) — the chip shows the surface but filters by the lemma.
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

// Single-selection ToggleButtonGroup exposes the chips as `radio` inside a `radiogroup`, not as
// `button`/`aria-pressed` — the right semantics for "at most one of these is active", and what
// gives a screen reader the "2 of 3" positional context a bare toggle would not.
const chip = (name: RegExp): HTMLElement => screen.getByRole("radio", { name });

describe("segment bar", () => {
  it("renders content words as tappable chips and particles as inert text", () => {
    // WHY: the whole affordance is "content words are clickable, particles aren't" — a particle
    // rendered as a control would mislead the user into a pointless filter.
    render(
      <SegmentBar
        segments={segments}
        selected={null}
        onSelectSegment={() => {}}
      />
    );
    expect(chip(/日本語/)).toBeDefined();
    expect(chip(/勉強する/)).toBeDefined();
    // The particle を is present as text but NOT a control.
    expect(screen.getByText("を")).toBeDefined();
    expect(screen.queryByRole("radio", { name: /を/ })).toBeNull();
  });

  it("selects a chip by its INDEX, so a repeated word stays separately selectable", () => {
    // WHY: the filter is keyed positionally, not by lemma — a sentence can use the same word twice
    // (行って…行く) and tapping the second chip must not select the first. Index 2 is the verb.
    const onSelect = vi.fn<(index: number | null) => void>();
    render(
      <SegmentBar
        segments={segments}
        selected={null}
        onSelectSegment={onSelect}
      />
    );
    fireEvent.click(chip(/勉強する/));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("clears the filter when the active chip is tapped again", () => {
    // WHY: the toggle IS the escape hatch — there is no separate "show everything" control, so if
    // re-tapping did not deselect, a user could filter themselves into a corner (#16). This is why
    // the group must NOT set `disallowEmptySelection`.
    const onSelect = vi.fn<(index: number | null) => void>();
    render(
      <SegmentBar segments={segments} selected={2} onSelectSegment={onSelect} />
    );
    fireEvent.click(chip(/勉強する/));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("marks the active chip as checked for assistive tech", () => {
    // WHY: a filter whose state is conveyed only by colour is invisible to a screen reader.
    render(
      <SegmentBar segments={segments} selected={0} onSelectSegment={() => {}} />
    );
    expect(chip(/日本語/).getAttribute("aria-checked")).toBe("true");
    expect(chip(/勉強する/).getAttribute("aria-checked")).toBe("false");
  });

  it("tags content chips with their part of speech for theme-aware coloring", () => {
    // WHY: POS coloring (via data-pos → CVA/CSS) is how the breakdown reads at a glance; a missing
    // data-pos would drop the color cue.
    render(
      <SegmentBar
        segments={segments}
        selected={null}
        onSelectSegment={() => {}}
      />
    );
    expect(chip(/日本語/).getAttribute("data-pos")).toBe("noun");
    expect(chip(/勉強する/).getAttribute("data-pos")).toBe("verb");
  });
});
