import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { setHostSettings } from "../../__tests__/hostSettingsHarness";
import { ExampleSentence } from "../ExampleSentence";

describe("example sentence", () => {
  // The settings store is module scope, so a case that turns colouring off would leak into the next.
  afterEach(async () => {
    await setHostSettings();
  });

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

  it("colours particles without making them tappable", () => {
    // WHY (#38, user report): example colouring used to ride the LINK data alone, so it could only
    // express 4 of the 9 palette categories — particles, auxiliaries, pronouns, adnominals and
    // utterances rendered as plain foreground. That left the uncoloured grammatical connectives as
    // the brightest text in the sentence, inverting the emphasis the palette exists to give.
    //
    // But は must NOT become a tap target: opening a JMdict entry for a particle helps nobody, and
    // making every particle tappable would bury the links that are genuinely useful.
    render(
      <ExampleSentence
        markup="[{私|わたし}](pn:1311110)[は](p:)[{本|ほん}](n:1522150)[を](p:)[{読|よ}む](v:1535390)"
        onOpenWord={vi.fn<(id: string) => void>()}
      />
    );
    // `Ruby` wraps its content in its own span, so getByText returns the INNER element — walk up to
    // the one carrying the attribute.
    const carrier = (text: string): Element => {
      const el = screen.getByText(text).closest("[data-pos]");
      if (el === null) throw new Error(`no [data-pos] ancestor for ${text}`);
      return el;
    };
    const wa = carrier("は");
    expect(wa).toHaveAttribute("data-pos", "particle");
    expect(wa.tagName).toBe("SPAN"); // not a BUTTON: coloured, but nothing to open
    // Three linked words; the two particles are not among them.
    expect(screen.getAllByRole("button")).toHaveLength(3);
    // And the categories the old link-only markup could never express now appear.
    expect(carrier("私")).toHaveAttribute("data-pos", "pronoun");
  });

  it("colours each linked word by its part of speech", () => {
    // WHY: an example sentence should read as STRUCTURE, not just as a string — the same hue that
    // word wears in the breakdown bar, the grammar pills and the editor. The POS is already in the
    // link target, so this must come from the markup rather than a second data source that could
    // disagree with the tap target.
    render(
      <ExampleSentence
        markup="[{食|た}べる](v:1358280)のが[{好|す}き](adj:1277440)です"
        onOpenWord={vi.fn<(id: string) => void>()}
      />
    );
    const [verb, adjective] = screen.getAllByRole("button");
    expect(verb).toHaveAttribute("data-pos", "verb");
    expect(adjective).toHaveAttribute("data-pos", "adjective");
  });

  it("drops the colour attribute entirely when colorExamples is off", async () => {
    // WHY the attribute is OMITTED rather than set to an "off" value: every consumer of
    // `--pos-color` already falls back to a neutral colour for words that have no category, so the
    // disabled state reuses that path and needs no styling of its own. Setting `data-pos=""` or a
    // sentinel would instead require a rule to suppress it, which is the bug this avoids.
    await setHostSettings({ colorExamples: false });
    render(
      <ExampleSentence
        markup="[{食|た}べる](v:1358280)[のが](p:)[{好|す}き](adj:1277440)です"
        onOpenWord={vi.fn<(id: string) => void>()}
      />
    );
    for (const word of screen.getAllByRole("button")) {
      expect(word).not.toHaveAttribute("data-pos");
    }
    // Spans too — the setting governs the whole sentence, not just the tappable half. Asserted via
    // `closest`, so this fails if the span merely nests differently rather than losing its colour;
    // a bare getByText would pass on the inner Ruby element either way.
    expect(screen.getByText("のが").closest("[data-pos]")).toBeNull();
    // The words stay tappable — this setting is about colour, not about linkification.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
