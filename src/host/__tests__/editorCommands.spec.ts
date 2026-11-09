import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Rewriting the editor's text (spacing, furigana) when the text changes under the rewrite.
 *
 * The transform awaits the tokenizer, so the document can change while it runs. VS Code then
 * refuses the edit, and the command used to do nothing and say nothing (audit I-12).
 */

const warnings: string[] = [];
const editors = vi.hoisted(() => ({ active: undefined as unknown }));

vi.mock("vscode", () => ({
  window: {
    get activeTextEditor() {
      return editors.active;
    },
    showWarningMessage: async (message: string) => {
      warnings.push(message);
      return undefined;
    }
  },
  Range: class {
    constructor(
      readonly startLine: number,
      readonly startCol: number,
      readonly endLine: number,
      readonly endCol: number
    ) {}
  }
}));
vi.mock("../tokenizer", () => ({ segment: async () => [] }));

const { transformEditorText } = await import("../editorCommands");

/** A one-line document whose text — and version — a test can change mid-transform. */
const fakeEditor = (
  text: string,
  { refuses = false }: { refuses?: boolean } = {}
): {
  document: { text: string; version: number };
  applied: string[];
  type: (next: string) => void;
} => {
  const document = {
    text,
    version: 1,
    lineCount: 1,
    lineAt: () => ({ text: document.text }),
    getText: () => document.text
  };
  const applied: string[] = [];
  editors.active = {
    document,
    selection: { isEmpty: true },
    edit: async (
      build: (edit: { replace: (range: unknown, text: string) => void }) => void
    ) => {
      if (refuses) return false;
      build({
        replace: (_range, next) => {
          applied.push(next);
          document.text = next;
          document.version++;
        }
      });
      return true;
    }
  };
  return {
    document,
    applied,
    type: (next) => {
      document.text = next;
      document.version++;
    }
  };
};

describe("rewriting the editor's text", () => {
  beforeEach(() => {
    warnings.length = 0;
  });

  it("rewrites the text it read", async () => {
    // WHY: the ordinary case must stay one transform and one edit.
    const editor = fakeEditor("猫");
    await transformEditorText(async (text) => `[${text}]`);
    expect(editor.applied).toEqual(["[猫]"]);
    expect(warnings).toEqual([]);
  });

  it("redoes the rewrite on the new text when the text changed meanwhile", async () => {
    // WHY: an edit built from the old text would be refused — or worse, if it were not, overwrite
    // what was typed. Redone on the current text, the command still does what was asked.
    const editor = fakeEditor("猫");
    let calls = 0;
    await transformEditorText(async (text) => {
      calls++;
      if (calls === 1) editor.type("猫が");
      return `[${text}]`;
    });
    expect(editor.applied).toEqual(["[猫が]"]);
    expect(warnings).toEqual([]);
  });

  it("says so when the text keeps changing", async () => {
    // WHY: silence was the bug. A command that changes nothing must say why.
    const editor = fakeEditor("猫");
    await transformEditorText(async (text) => {
      editor.type(`${text}が`);
      return `[${text}]`;
    });
    expect(editor.applied).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("says so when VS Code refuses the edit", async () => {
    // WHY: `edit` answers false without throwing, and that answer used to be thrown away.
    const editor = fakeEditor("猫", { refuses: true });
    await transformEditorText(async (text) => `[${text}]`);
    expect(editor.applied).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});
