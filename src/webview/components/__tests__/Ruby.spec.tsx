// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Ruby } from "../Ruby";

describe("ruby furigana", () => {
  it("renders kanji with furigana over it", () => {
    // WHY: the whole point — {食|た}べる shows た above 食, plain kana passes through.
    render(<Ruby markup="{食|た}べる" />);
    const rt = document.querySelector("rt");
    expect(rt?.textContent).toBe("た");
    // The base and trailing kana are both present as text.
    expect(screen.getByText("食")).toBeDefined();
    expect(screen.getByText(/べる/)).toBeDefined();
  });

  it("passes non-markup text through unchanged", () => {
    // WHY: a sentence is furigana groups interleaved with plain kana/punctuation; the plain parts
    // must render verbatim, not be dropped or mangled.
    render(<Ruby markup="私は{本|ほん}を読む。" />);
    expect(screen.getByText(/私は/)).toBeDefined();
    expect(screen.getByText(/を読む。/)).toBeDefined();
  });
});
