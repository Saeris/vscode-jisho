import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vite-plus/test";

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
/** Switched on by the test that needs the tokenizer to fail, as a bad dictionary would make it. */
let segmentFails = false;
/**
 * How long each tokenizer call blocks the thread, as the real one does (~0.7 ms a line of dense
 * prose). Zero unless a test needs a pass long enough to be interrupted.
 */
let segmentBlocksMs = 0;
vi.mock("../tokenizer", () => ({
  segment: async (text: string) => {
    segmentCalls.push(text);
    if (segmentFails) throw new Error("tokenizer failed to build");
    const until = performance.now() + segmentBlocksMs;
    while (performance.now() < until) {
      // Busy, like the native tokenizer: nothing else on this thread runs meanwhile.
    }
    return [];
  }
}));

const warnings: string[] = [];
vi.mock("../log", () => ({
  log: () => ({ warn: (message: string) => warnings.push(message) })
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

describe("posDecorator failures", () => {
  /** An editor showing one line of Japanese, enough for a pass to reach the tokenizer. */
  const japaneseEditor = (): FakeEditor & Record<string, unknown> => ({
    document: {
      uri: { toString: () => "file:///notes.md" },
      languageId: "markdown",
      lineCount: 1,
      lineAt: () => ({ text: "猫が好きです。" })
    } as never,
    visibleRanges: [{ start: { line: 0 }, end: { line: 0 } }],
    setDecorations: () => undefined
  });

  it("logs a failed pass once and does not reject", async () => {
    // WHY: every caller discards this promise (`void this.refresh(...)`), so a throw here was an
    // unhandled rejection on every scroll and keystroke for as long as the tokenizer stayed broken
    // (audit SM-6). Logged once, because a persistent failure repeats on every repaint after it.
    segmentFails = true;
    warnings.length = 0;
    const decorator = new PosDecorator();
    const editor = japaneseEditor();
    await expect(decorator.refresh(editor as never)).resolves.toBeUndefined();
    await expect(decorator.refresh(editor as never)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/colouring failed/u);
    decorator.dispose();
    segmentFails = false;
  });
});

describe("posDecorator passes", () => {
  /** A document of `lines` distinct lines of Japanese. */
  type ProseDocument = FakeEditor["document"] & {
    lineCount: number;
    lineAt: (line: number) => { text: string };
  };
  const proseDocument = (lines: number): ProseDocument => ({
    uri: { toString: () => "file:///notes.md" },
    languageId: "markdown",
    lineCount: lines,
    lineAt: (line: number) => ({ text: `猫が${line}匹います。` })
  });

  /** An editor showing all of `document`, counting what it is asked to paint. */
  const proseEditor = (
    lines: number,
    document = proseDocument(lines)
  ): FakeEditor & { painted: number } & Record<string, unknown> => {
    const editor = {
      painted: 0,
      document,
      visibleRanges: [{ start: { line: 0 }, end: { line: lines - 1 } }],
      setDecorations: () => {
        editor.painted++;
      }
    };
    return editor;
  };

  beforeEach(() => {
    segmentCalls.length = 0;
    segmentBlocksMs = 0;
  });

  // Here rather than at the end of the one test that fakes timers: a failing assertion skips the
  // rest of a test, and fake timers left on would hang every later test that waits on a real one.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("colours both editors of a split view", async () => {
    // WHY: passes were keyed by DOCUMENT, so the second editor on a document cancelled the first
    // one's pass, and only one side of a split view was ever coloured (audit SM-6).
    const decorator = new PosDecorator();
    const document = proseDocument(3);
    const left = proseEditor(3, document);
    const right = proseEditor(3, document);
    await Promise.all([
      decorator.refresh(left as never),
      decorator.refresh(right as never)
    ]);
    expect(left.painted).toBeGreaterThan(0);
    expect(right.painted).toBeGreaterThan(0);
    decorator.dispose();
  });

  it("gives each editor of a split view its own debounce", () => {
    // WHY: typing in a split view schedules a repaint for EVERY visible editor of the document. On
    // one shared timer the second cancelled the first, which is how the split view lost its colour.
    vi.useFakeTimers();
    const decorator = new PosDecorator();
    const refresh = vi.spyOn(decorator, "refresh").mockResolvedValue();
    const document = proseDocument(1);
    const left = proseEditor(1, document);
    const right = proseEditor(1, document);
    decorator.refreshSoon(left as never);
    decorator.refreshSoon(right as never);
    vi.advanceTimersByTime(150);
    expect(refresh).toHaveBeenCalledTimes(2);
    decorator.dispose();
  });

  it("lets a newer pass interrupt one that is still running", async () => {
    // WHY: a pass is ~120 tokenizer calls, and none of them gave the event loop a turn — so the
    // keystroke or scroll meant to supersede it could only run after it had finished, with the
    // whole extension host blocked meanwhile (audit SM-6, P-2). Only the newest pass may paint.
    segmentBlocksMs = 1;
    const decorator = new PosDecorator();
    const editor = proseEditor(100);
    let second: Promise<void> | undefined;
    const first = decorator.refresh(editor as never);
    setTimeout(() => {
      second = decorator.refresh(editor as never);
    }, 0);
    await first;
    await vi.waitFor(() => expect(second).toBeDefined());
    await second;
    // One pass's worth of `setDecorations` — one per category — not two.
    expect(editor.painted).toBe(9);
    decorator.dispose();
  });

  it("does not tokenize again what it has already coloured", async () => {
    // WHY: scrolling back over coloured text, or a repaint after an edit elsewhere, tokenized every
    // visible line again — ~0.7 ms each, on the thread every extension shares.
    const decorator = new PosDecorator();
    const editor = proseEditor(20);
    await decorator.refresh(editor as never);
    expect(segmentCalls.length).toBeGreaterThan(0);
    segmentCalls.length = 0;
    await decorator.refresh(editor as never);
    expect(segmentCalls).toEqual([]);
    expect(editor.painted).toBe(18);
    decorator.dispose();
  });
});
