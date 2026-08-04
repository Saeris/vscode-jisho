import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setHostSettings } from "../../__tests__/hostSettingsHarness";
import { NavigationProvider } from "../../navigation";
import { TagPills } from "../TagPill";

const tag = (code: string, description: string) => ({ code, description });

/**
 * Render inside a NavigationProvider: a pill whose category the browse tree offers is a BUTTON that
 * opens that list (#27), so it reads navigation from context. The captured events let a test assert
 * where a tap goes without a real machine.
 */
const navEvents: { type: string }[] = [];
const renderPills = (ui: React.ReactElement): ReturnType<typeof render> => {
  navEvents.length = 0;
  return render(
    <NavigationProvider send={(e) => navEvents.push(e)} canGoHome={false}>
      {ui}
    </NavigationProvider>
  );
};

const setTagLabels = async (tagLabels: "english" | "japanese"): Promise<void> =>
  setHostSettings({ tagLabels });

describe("tagPills", () => {
  // The settings store is module scope — shared across cases in this file — so a case that
  // switches to Japanese would leak into the next one.
  afterEach(async () => {
    await setHostSettings();
  });

  it("shows a compact label, not the JMdict description", () => {
    // WHY the feature exists (#50): それぞれ's grammar line read "adverb (fukushi), noun (common)
    // (futsuumeishi), nouns which may take the genitive case particle 'no', word usually written
    // using kana alone" — a paragraph of metadata above a one-line definition.
    renderPills(
      <TagPills
        pos={[
          tag("adv", "adverb (fukushi)"),
          tag("n", "noun (common) (futsuumeishi)")
        ]}
        usage={[]}
      />
    );
    expect(screen.getByText("adverb")).toBeInTheDocument();
    expect(screen.getByText("noun")).toBeInTheDocument();
    expect(screen.queryByText(/fukushi/)).not.toBeInTheDocument();
  });

  it("defaults to English and switches the whole vocabulary on the setting", async () => {
    // WHY: English is the default because 名詞 is only compact if you ALREADY read it — the pill
    // has to be legible to the learner the extension is for. The Japanese terms are what a textbook
    // uses, so they are one setting away, and the setting has to move POS and usage tags together:
    // a row reading "noun 尊敬語" would be worse than either mode.
    const pos = [tag("n", "noun (common) (futsuumeishi)")];
    const usage = [tag("hon", "honorific or respectful (sonkeigo) language")];
    const { rerender } = renderPills(<TagPills pos={pos} usage={usage} />);
    expect(screen.getByText("noun")).toBeInTheDocument();
    expect(screen.getByText("honorific")).toBeInTheDocument();

    await setTagLabels("japanese");
    rerender(
      <NavigationProvider send={() => {}} canGoHome={false}>
        <TagPills pos={pos} usage={usage} />
      </NavigationProvider>
    );
    expect(screen.getByText("名詞")).toBeInTheDocument();
    expect(screen.getByText("尊敬語")).toBeInTheDocument();
  });

  it("keeps the full description as the tooltip in both modes", async () => {
    // WHY: shortening a label must never LOSE the information — the description is how a learner
    // finds out what 尊敬語 means, and it is the ONLY place that meaning survives in Japanese mode.
    const pos = [tag("adv", "adverb (fukushi)")];
    const { rerender } = renderPills(<TagPills pos={pos} usage={[]} />);
    expect(screen.getByText("adverb")).toHaveAttribute(
      "title",
      expect.stringContaining("adverb (fukushi)")
    );

    await setTagLabels("japanese");
    rerender(
      <NavigationProvider send={() => {}} canGoHome={false}>
        <TagPills pos={pos} usage={[]} />
      </NavigationProvider>
    );
    expect(screen.getByText("副詞")).toHaveAttribute(
      "title",
      expect.stringContaining("adverb (fukushi)")
    );
  });

  it("colours parts of speech by palette category and leaves usage neutral", () => {
    // WHY: the hue is the SAME one that word wears in the breakdown bar and the editor, so "this
    // is a verb" is said the same way everywhere. Usage tags are not parts of speech — a hue would
    // imply a grammatical meaning they do not carry.
    renderPills(
      <TagPills
        pos={[tag("v1", "Ichidan verb")]}
        usage={[tag("uk", "word usually written using kana alone")]}
      />
    );
    expect(screen.getByText("ichidan verb")).toHaveAttribute(
      "data-pos",
      "verb"
    );
    expect(screen.getByText("kana")).not.toHaveAttribute("data-pos");
  });

  it("shortens only the usage tags that need it", () => {
    // WHY: the curated list is deliberately short. Measured over the shipped dictionary, most misc
    // tags are already pill-sized, so a general truncation rule would be solving a problem that
    // mostly does not exist — and would mangle the ones that read fine.
    renderPills(
      <TagPills
        pos={[]}
        usage={[
          tag("uk", "word usually written using kana alone"),
          tag("col", "colloquial")
        ]}
      />
    );
    expect(screen.getByText("kana")).toBeInTheDocument();
    expect(screen.getByText("colloquial")).toBeInTheDocument();
  });

  it("browses a tag's category when the tree offers one", async () => {
    // WHY (#27): tapping "godan verb" on 食べる asks "what else is a godan verb?" — the question a
    // reader has at that moment. `v1` maps to the Ichidan classifier through the same table the
    // browse tree and the #tag autocomplete read, so the three cannot offer different categories.
    renderPills(<TagPills pos={[tag("v1", "Ichidan verb")]} usage={[]} />);
    await userEvent.click(screen.getByText("ichidan verb"));
    expect(navEvents).toEqual([{ type: "openWordList", id: "verb-ichidan" }]);
  });

  it("leaves a tag the browse tree does not surface inert", () => {
    // WHY: JMdict has 52 POS codes and the tree deliberately surfaces ~20 — a list of every
    // classical `v2g-s` variant is reference trivia. Those pills must not look tappable, or the
    // affordance would be lying about where it leads.
    renderPills(
      <TagPills
        pos={[tag("v2g-s", "Nidan verb (lower class) with 'gu' ending")]}
        usage={[]}
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when a sense carries no tags", () => {
    // WHY: an empty pill row would still occupy vertical space above the definition.
    const { container } = renderPills(<TagPills pos={[]} usage={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
