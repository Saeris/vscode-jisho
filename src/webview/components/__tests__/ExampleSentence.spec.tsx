// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ExampleSentence } from "../ExampleSentence";

describe("example sentence", () => {
  afterEach(cleanup);

  it("renders linked words as buttons and plain runs as text, with furigana", () => {
    // WHY: the sentence interleaves tappable words and plain runs (particles). Both render, and the
    // linked word carries its furigana — the whole point of the build-time linkification.
    render(
      <ExampleSentence
        markup="お[{茶|ちゃ}](n:1000710)を[{飲|の}みませんか](v:1168720)"
        onOpenWord={vi.fn<(id: string) => void>()}
      />
    );
    // Two linked words → two buttons; the plain particle を is not a button.
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("を")).toBeDefined();
    // Furigana rendered inside a link.
    expect(document.querySelector("rt")?.textContent).toBe("ちゃ");
  });

  it("opens the tapped word's entry by its id (F1-links, open-by-id)", async () => {
    // WHY: tapping a word opens THAT entry directly (not a search) — the id encoded at build time is
    // authoritative within the DB it ships with. The correct id must reach onOpenWord.
    const onOpenWord = vi.fn<(id: string) => void>();
    render(
      <ExampleSentence
        markup="[{食|た}べる](v:1358280)のが[{好|す}き](adj:1277440)です"
        onOpenWord={onOpenWord}
      />
    );
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(onOpenWord).toHaveBeenCalledWith("1358280");
  });
});
