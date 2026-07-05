import { describe, it, expect, vi, beforeEach } from "vitest";

// `vscode` is provided by the extension host at runtime, not installed as a
// package — mock it so the entry point can be unit-tested in a node env.
const registerCommand = vi.fn<
  (command: string, callback: () => void) => { dispose: () => void }
>((_command, _callback) => ({ dispose: vi.fn<() => void>() }));
const showInformationMessage = vi.fn<(message: string) => void>();

vi.mock("vscode", () => ({
  commands: { registerCommand },
  window: { showInformationMessage }
}));

const { activate, deactivate } = await import("../index");

describe("extension entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the helloWorld command and tracks it for disposal", () => {
    // WHY: an extension that fails to register its contributed command, or
    // forgets to push the disposable, leaks handlers and breaks on reload.
    const subscriptions: { dispose: () => void }[] = [];
    activate({ subscriptions } as never);

    expect(registerCommand).toHaveBeenCalledWith(
      "vscode-extension-template.helloWorld",
      expect.any(Function)
    );
    expect(subscriptions).toHaveLength(1);
  });

  it("shows a message when the command runs", () => {
    activate({ subscriptions: [] } as never);
    const handler = registerCommand.mock.calls[0][1];
    handler();
    expect(showInformationMessage).toHaveBeenCalledWith("Hello World!");
  });

  it("deactivates without throwing", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
