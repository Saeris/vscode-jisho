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
  it("keeps the spellchecker off the query box", () => {
    // WHY: a query is Japanese, a romaji reading, or a `#tag` — never English prose, so left on the
    // spellchecker red-underlines effectively every search typed. `Autocomplete` sets this for us
    // today, which is exactly why it is worth a test: nothing in THIS file would show up as broken
    // if a version bump stopped doing it, and the field is a contenteditable div rather than an
    // <input>, where the attribute is the only thing turning it off.
    setup();
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "spellcheck",
      "false"
    );
  });

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

  /**
   * Drive an IME the way Chromium does, which is the only way these paths can be exercised:
   * `userEvent` has no composition support of its own.
   *
   * The text is typed through `userEvent` rather than written to `textContent`, because React Aria
   * reads edits via `beforeinput` and ignores the DOM being mutated behind its back — a helper that
   * assigns `textContent` produces a field the library never sees, and tests that pass against it
   * prove nothing about the product. (Measured: `onChange` never fired at all.)
   *
   * The ORDER is the part that matters, and it was measured against real Chromium via CDP
   * `Input.imeSetComposition`: every draft arrives as an `input` with `isComposing` true, the
   * COMMITTED text arrives the same way — still `isComposing` true — and `compositionend` comes
   * last. A helper that fired `compositionend` before the final input would pass against an
   * implementation that is wrong in the product.
   */
  const composeInto = async (
    box: HTMLElement,
    drafts: string[],
    committed: string
  ): Promise<void> => {
    await userEvent.click(box);
    box.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true })
    );
    // Each draft REPLACES the one before it, as an IME's composition region does.
    let shown = "";
    for (const draft of [...drafts, committed]) {
      if (shown !== "") {
        await userEvent.keyboard("{Backspace>" + shown.length + "/}");
      }
      await userEvent.keyboard(draft);
      shown = draft;
      // Mark what was just typed as composing, which is what the gate reads.
      box.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          isComposing: true,
          data: draft
        })
      );
    }
    box.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: committed })
    );
  };

  it("does not search the drafts an IME passes through on the way to a word", async () => {
    // WHY: typing 日本 goes through に, にほ, にほん first. Those are not what the reader asked to
    // look up, and にほ is a REAL entry (二歩), so searching drafts does not merely waste queries —
    // it renders confidently wrong results on the way to the right ones.
    //
    // React Aria will not do this for us: it tracks composition for the caret and the token DOM but
    // deliberately still emits `onChange` per draft, to keep autocomplete working. So this asserts
    // OUR suppression, and it would fail the moment that gate is removed.
    const { changes } = setup();
    const box = screen.getByRole("searchbox");
    await composeInto(box, ["に", "にほ", "にほん"], "日本");

    expect(changes.map((c) => c.text)).not.toContain("にほ");
    expect(changes.map((c) => c.text)).not.toContain("にほん");
  });

  it("searches the committed word exactly once", async () => {
    // WHY: the counterpart to the test above, and the reason suppression cannot be the whole fix.
    // Chromium delivers the committed text with `isComposing` STILL TRUE and only then fires
    // `compositionend`, so the final value is one the gate withheld. If nothing searched it at
    // `compositionend`, the word would never be searched at all — the field would go quiet, which
    // is far worse than searching too often.
    const { changes } = setup();
    const box = screen.getByRole("searchbox");
    await composeInto(box, ["に", "にほ", "にほん"], "日本");

    expect(changes.filter((c) => c.text === "日本")).toHaveLength(1);
    expect(changes.at(-1)?.text).toBe("日本");
  });

  it("keeps searching per keystroke when no IME is involved", async () => {
    // WHY: romaji and English have no draft phase, so there is nothing to wait for — results should
    // still track each keystroke. This guards the gate from over-reaching into the common path: a
    // flag that latched on and never cleared would silently stop ordinary search, and nothing else
    // in this file would notice.
    const { changes } = setup();
    const box = screen.getByRole("searchbox");
    await userEvent.click(box);
    await userEvent.keyboard("taberu");

    expect(changes.at(-1)?.text).toBe("taberu");
    expect(changes.length).toBeGreaterThan(1);
  });
});
