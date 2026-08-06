import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The debounce on the text-change trigger.
 *
 * These tests are about WHICH trigger coalesces and which does not, because that distinction is the
 * whole design: typing must coalesce (a repaint per keystroke is a tokenizer call per visible line
 * for text the reader is still in the middle of writing), while scrolling and editor switches must
 * NOT, since there the delay is visible as uncoloured text already on screen.
 */

interface FakeEditor {
  document: { uri: { toString: () => string }; languageId: string };
  setDecorations: (type: unknown, ranges: unknown[]) => void;
}

const decorationTypes: { disposed: boolean }[] = [];

vi.mock("vscode", () => ({
  window: {
    createTextEditorDecorationType: () => {
      const type = {
        disposed: false,
        dispose(): void {
          this.disposed = true;
        }
      };
      decorationTypes.push(type);
      return type;
    },
    visibleTextEditors: [] as FakeEditor[]
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) =>
        key === "highlighting.enabled" ? true : fallback
    })
  },
  Range: class {
    constructor(
      public startLine: number,
      public startCol: number,
      public endLine: number,
      public endCol: number
    ) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  DecorationRangeBehavior: { ClosedClosed: 1 }
}));

// The tokenizer is a native addon; the debounce has nothing to do with it, and loading it here
// would make these tests depend on the dictionary being provisioned.
const segmentCalls: string[] = [];
vi.mock("../tokenizer", () => ({
  segment: async (text: string) => {
    segmentCalls.push(text);
    return [];
  }
}));

const { PosDecorator } = await import("../posDecorations");

const editor = (uri: string): FakeEditor => ({
  document: {
    uri: { toString: () => uri },
    languageId: "markdown"
  },
  setDecorations: () => undefined
});

describe("posDecorator debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    decorationTypes.length = 0;
    segmentCalls.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("repaints once for a burst of keystrokes, not once per keystroke", () => {
    const decorator = new PosDecorator();
    const refresh = vi.spyOn(decorator, "refresh").mockResolvedValue();
    const doc = editor("file:///a.md");

    // Eight keystrokes inside the debounce window — a plausible half-second of typing.
    for (let i = 0; i < 8; i++) {
      decorator.refreshSoon(doc as never);
      vi.advanceTimersByTime(20);
    }
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(refresh).toHaveBeenCalledTimes(1);

    decorator.dispose();
  });

  it("keeps each editor on its own timer", () => {
    // Two documents open side by side: typing in one must not cancel the other's pending repaint,
    // which a single shared timer would do.
    const decorator = new PosDecorator();
    const refresh = vi.spyOn(decorator, "refresh").mockResolvedValue();

    decorator.refreshSoon(editor("file:///a.md") as never);
    decorator.refreshSoon(editor("file:///b.md") as never);
    vi.advanceTimersByTime(150);

    expect(refresh).toHaveBeenCalledTimes(2);
    decorator.dispose();
  });

  it("drops a pending repaint on dispose", () => {
    // A timer surviving dispose would call setDecorations with decoration types already disposed —
    // the failure mode this clear exists for.
    const decorator = new PosDecorator();
    const refresh = vi.spyOn(decorator, "refresh").mockResolvedValue();

    decorator.refreshSoon(editor("file:///a.md") as never);
    decorator.dispose();
    vi.advanceTimersByTime(1000);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores a refresh scheduled after dispose", () => {
    const decorator = new PosDecorator();
    const refresh = vi.spyOn(decorator, "refresh").mockResolvedValue();

    decorator.dispose();
    decorator.refreshSoon(editor("file:///a.md") as never);
    vi.advanceTimersByTime(1000);

    expect(refresh).not.toHaveBeenCalled();
  });
});
