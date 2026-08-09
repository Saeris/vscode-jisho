import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

const reportCrash = vi.fn<(message: string, stack: string) => Promise<void>>(
  async () => undefined
);
vi.mock("../../bridge", () => ({
  reportCrash: async (message: string, stack: string) =>
    reportCrash(message, stack)
}));

/** Throws on its first render, then behaves — so "Try again" has something to recover to. */
const Flaky = ({ throws }: { throws: boolean }): React.ReactElement => {
  if (throws) {
    const error = new Error("Cannot read properties of undefined");
    error.stack = [
      "Error: Cannot read properties of undefined",
      "    at WordDetail (https://file+.vscode-resource.vscode-cdn.net/c%3A/Users/drake/.vscode/extensions/saeris.vscode-jisho-1.0.0/dist/webview/index.js:48213:19)"
    ].join("\n");
    throw error;
  }
  return <p>the panel</p>;
};

describe("error boundary", () => {
  beforeEach(() => {
    // React logs a caught error to the console by design; the boundary logs its own too. Silenced
    // so a passing run is not full of red that means nothing.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the panel when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Flaky throws={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("the panel")).toBeDefined();
  });

  it("replaces a crashed panel with a recoverable screen", () => {
    render(
      <ErrorBoundary>
        <Flaky throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it("says the dictionary is not damaged", () => {
    // WHY: a crash in the panel LOOKS, to someone who just waited for a 450 MB download, like their
    // dictionary broke. Saying otherwise is what stops an uninstall, so it is asserted rather than
    // left as prose someone may later trim.
    render(
      <ErrorBoundary>
        <Flaky throws />
      </ErrorBoundary>
    );
    expect(screen.getByText(/dictionary itself is fine/i)).toBeDefined();
  });

  it("leads with the way back, not the report", () => {
    // WHY: the primary action is getting the user working again. Asserted on DOM ORDER because that
    // is what the reader encounters first, and it is the decision most likely to be quietly
    // reversed by someone optimising for report volume.
    render(
      <ErrorBoundary>
        <Flaky throws />
      </ErrorBoundary>
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).toMatch(/try again/i);
    expect(buttons[1].textContent).toMatch(/report/i);
  });

  it("reports a SANITIZED stack, never the user's paths", () => {
    // WHY: this is the privacy boundary. The report is public and one click away, so a stack
    // carrying `/Users/drake` publishes the reporter's account name. Asserted on what crosses the
    // bridge, because that is the last point at which it could still be caught.
    render(
      <ErrorBoundary>
        <Flaky throws />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(reportCrash).toHaveBeenCalledTimes(1);
    const [message, stack] = reportCrash.mock.calls[0];
    expect(message).toBe("Cannot read properties of undefined");
    expect(stack).not.toContain("drake");
    expect(stack).not.toContain("Users");
    // Still useful: the function and its position survived.
    expect(stack).toContain("at WordDetail (webview/index.js:48213:19)");
  });

  it("recovers when the child stops throwing", () => {
    // WHY: a transient render bug should not cost the user their session. Without a reset the panel
    // stays dead until the sidebar is closed and reopened, which most people will not think to do.
    const { rerender } = render(
      <ErrorBoundary>
        <Flaky throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeDefined();
    // The child is fixed first: clicking "Try again" while it still throws would simply re-crash,
    // which is correct behaviour and not what this test is about.
    rerender(
      <ErrorBoundary>
        <Flaky throws={false} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("the panel")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
