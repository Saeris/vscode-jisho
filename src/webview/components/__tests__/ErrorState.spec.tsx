import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorState } from "../ErrorState";

const reportCrash = vi.fn<(message: string, stack?: string) => Promise<void>>(
  async () => undefined
);
vi.mock("../../bridge", () => ({
  reportCrash: async (message: string, stack?: string) =>
    reportCrash(message, stack)
}));

describe("error state", () => {
  it("shows the error's own message", () => {
    render(
      <ErrorState
        error={new Error("Dictionary schema version 5 does not match 6")}
        context="loading the word page"
      />
    );
    expect(screen.getByText(/schema version 5/)).toBeDefined();
  });

  it("falls back when the failure is not an Error", () => {
    // WHY: a rejection can carry anything. `String(value)` on an object gives "[object Object]",
    // which tells a reader nothing, so a non-Error takes the caller's plain-language fallback.
    render(
      <ErrorState
        error={{ weird: true }}
        context="searching"
        fallback="Search failed."
      />
    );
    expect(screen.getByText("Search failed.")).toBeDefined();
  });

  it("offers a way to report, which is the whole point", () => {
    // WHY: these views ALREADY rendered their error before spec 21 — as a bare paragraph. The gap
    // was that reading one was a dead end, so the report action is the feature, not the message.
    render(<ErrorState error={new Error("boom")} context="searching" />);
    expect(
      screen.getByRole("button", { name: /report this problem/i })
    ).toBeDefined();
  });

  it("reports the context with the message, and no stack", () => {
    // WHY: the context is what makes an issue title useful — "searching: boom" locates the failure
    // where "boom" does not. And no stack, deliberately: a query rejection's stack is the bridge's
    // plumbing rather than the cause, so sending it would put noise where the signal should be.
    render(<ErrorState error={new Error("boom")} context="searching" />);
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(reportCrash).toHaveBeenCalledWith("searching: boom", undefined);
  });

  it("says the dictionary is unaffected", () => {
    // WHY: same reasoning as the crash screen. A word that fails to load looks, to someone who just
    // waited for a 450 MB download, like the download broke.
    render(<ErrorState error={new Error("boom")} context="searching" />);
    expect(screen.getByText(/dictionary is not affected/i)).toBeDefined();
  });
});
