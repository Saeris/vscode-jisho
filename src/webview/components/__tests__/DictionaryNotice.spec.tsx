import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { DictionaryStatus } from "../../../shared/messages";

/** The status the notice reads. Replaced (never mutated) so the store sees a new snapshot. */
const store = vi.hoisted(() => ({
  current: {
    words: { state: "ready" },
    names: { state: "absent" }
  }
}));
const actions = vi.hoisted(() => [] as string[]);

vi.mock("../../bridge", () => ({
  getDictionaryStatus: () => store.current,
  onDictionaryStatus: () => () => undefined,
  dictionaryAction: async (action: string) => {
    actions.push(action);
  },
  reportCrash: async () => undefined
}));

const { DictionaryNotice } = await import("../DictionaryNotice");

const show = (words: DictionaryStatus): HTMLElement => {
  store.current = { words, names: { state: "absent" } };
  return render(<DictionaryNotice />).container;
};

describe("dictionary notice", () => {
  beforeEach(() => {
    actions.length = 0;
  });

  it("shows first-run download progress instead of an endless search", () => {
    // WHY: the panel used to show "Searching…" for the whole 119 MB download, with the only
    // progress in a VS Code notification it did not know about (audit SM-10).
    show({ state: "downloading", percent: 40 });
    expect(screen.getByText(/Downloading the dictionary — 40%/u)).toBeDefined();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "40"
    );
  });

  it("offers a retry when the download could not reach the network", async () => {
    // WHY: offline is the one failure a retry fixes; asking the user to report it would be wrong.
    show({ state: "failed", reason: "offline", message: "fetch failed" });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions).toEqual(["retry"]);
    expect(screen.queryByRole("button", { name: /report/iu })).toBeNull();
  });

  it("sends a newer dictionary to a newer Jisho, not to a dictionary update", async () => {
    // WHY: this was a dead end (audit I-2). The old message said "the database needs to be
    // updated", but the update check then found nothing newer and reported "up to date". Only a
    // newer Jisho can read a newer dictionary.
    show({ state: "failed", reason: "schema-newer", message: "schema 7 vs 6" });
    expect(
      screen.queryByRole("button", { name: /update the dictionary/iu })
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Update Jisho" }));
    expect(actions).toEqual(["updateJisho"]);
  });

  it("sends an older dictionary to a dictionary update", async () => {
    // WHY: the opposite case — here updating the dictionary is exactly the fix.
    show({ state: "failed", reason: "schema-older", message: "schema 5 vs 6" });
    await userEvent.click(
      screen.getByRole("button", { name: "Update the dictionary" })
    );
    expect(actions).toEqual(["update"]);
  });

  it("stays out of the way while the dictionary is ready", () => {
    // WHY: a status line on every search would be noise; the notice is for when something needs
    // the user's attention or patience.
    const container = show({ state: "ready" });
    expect(container.childElementCount).toBe(0);
  });
});
