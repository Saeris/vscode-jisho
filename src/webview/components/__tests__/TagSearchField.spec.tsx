import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Classifier } from "../../../shared/classifiers";
import { TagSearchField } from "../TagSearchField";

const setup = (): {
  changes: { text: string; tags: string[] }[];
  opened: string[];
} => {
  const changes: { text: string; tags: string[] }[] = [];
  const opened: string[] = [];
  render(
    <TagSearchField
      text=""
      onChange={(text: string, tags: Classifier[]) => {
        changes.push({ text, tags: tags.map((t) => t.id) });
      }}
      onOpenTag={(id: string) => opened.push(id)}
    />
  );
  return { changes, opened };
};

describe("tag search field", () => {
  it("opens the suggestions on # and narrows them as you type", async () => {
    // WHY (#27): typing `#` is the discovery path for someone who does not know the tag
    // vocabulary. It has to offer the list, then narrow it — otherwise the only way to find a tag
    // is to already know it.
    setup();
    const box = screen.getByRole("searchbox");
    await userEvent.click(box);
    await userEvent.keyboard("#jlpt");
    const options = await screen.findAllByRole("menuitem");
    expect(options.length).toBeGreaterThan(1);
    expect(options.map((o) => o.textContent)).toContain("N5#jlpt-n5");
  });

  it("moves the highlight with the arrow keys, without leaving the field", async () => {
    // WHY (user report): ↓ used to do nothing — the menu was outside the field's focus order, so
    // reaching it meant Tab, which hit the toolbar buttons first. The caret must STAY in the box
    // while ↑/↓ drive the list, or the next keystroke would go to the list instead of continuing
    // to filter it. That is the combobox contract.
    setup();
    const box = screen.getByRole("searchbox");
    await userEvent.click(box);
    await userEvent.keyboard("#jlpt");

    const selected = (): string | null =>
      screen
        .getAllByRole("menuitem")
        .find((o) => o.hasAttribute("data-focused"))?.textContent ?? null;

    expect(selected()).toBe("N5#jlpt-n5");
    await userEvent.keyboard("{ArrowDown}");
    expect(selected()).toBe("N4#jlpt-n4");
    await userEvent.keyboard("{ArrowUp}");
    expect(selected()).toBe("N5#jlpt-n5");
    // Focus never left the box.
    expect(document.activeElement).toBe(box);
  });

  it("commits the highlighted tag on Enter and puts the caret AFTER it", async () => {
    // WHY (user report): the caret landed BEFORE the new pill, so the next thing typed appeared on
    // the wrong side of the tag just picked. `replaceRange` leaves the caret where the replaced
    // text began, which — once that text becomes a token — is the far side of the pill.
    const { changes } = setup();
    const box = screen.getByRole("searchbox");
    await userEvent.click(box);
    await userEvent.keyboard("#jlpt-n5");
    await userEvent.keyboard("{Enter}");

    expect(changes.at(-1)?.tags).toEqual(["jlpt-n5"]);
    // Typing continues after the token, not before it — the text lands in the trailing segment.
    await userEvent.keyboard("taberu");
    expect(changes.at(-1)).toEqual({ text: "taberu", tags: ["jlpt-n5"] });
  });

  it("composes several tags, each a separate filter", async () => {
    // WHY (user report): tags are filters and must narrow TOGETHER. If a second tag replaced the
    // first, or the first were lost when the second tokenised, "#jlpt-n5 #verb-godan" would be
    // answering a different question than the one asked.
    const { changes } = setup();
    const box = screen.getByRole("searchbox");
    await userEvent.click(box);
    await userEvent.keyboard("#jlpt-n5");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("#verb-godan");
    await userEvent.keyboard("{Enter}");

    expect(changes.at(-1)?.tags).toEqual(["jlpt-n5", "verb-godan"]);
  });

  it("opens a lone tag's list on Enter", async () => {
    // WHY: a tag by itself is a request to BROWSE that category — the shortcut that makes typing
    // `#jlpt-n5` worth it over four taps through the tree.
    //
    // One Enter, not two: a fully-typed `#jlpt-n5` has ALREADY tokenised (that is what the value's
    // tokenizer does), so there is no fragment under the caret and no menu to dismiss first.
    const { opened } = setup();
    const box = screen.getByRole("searchbox");
    await userEvent.click(box);
    await userEvent.keyboard("#jlpt-n5");
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    await userEvent.keyboard("{Enter}");
    expect(opened).toEqual(["jlpt-n5"]);
  });

  it("commits a partially-typed tag on Enter rather than opening it", async () => {
    // WHY: the two Enter behaviours must not collide. With the menu open, Enter picks the
    // highlighted suggestion; it is only once nothing is left to complete that Enter means "open
    // this category". Getting that backwards would make the menu impossible to use by keyboard.
    const { changes, opened } = setup();
    const box = screen.getByRole("searchbox");
    await userEvent.click(box);
    await userEvent.keyboard("#jlpt-n");
    expect(screen.queryAllByRole("menuitem").length).toBeGreaterThan(0);
    await userEvent.keyboard("{Enter}");
    expect(opened).toEqual([]);
    expect(changes.at(-1)?.tags).toEqual(["jlpt-n5"]);
  });
});
