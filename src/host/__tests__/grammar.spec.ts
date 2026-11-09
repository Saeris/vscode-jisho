import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { IGrammar } from "vscode-textmate";

// Only `LineStates` is exercised, and it touches no vscode API — but the module imports it at load.
vi.mock("vscode", () => ({}));
vi.mock("../log", () => ({ log: () => ({ warn: () => undefined }) }));

const { LineStates } = await import("../grammar");

/** A grammar that tokenizes nothing, but counts the lines it is handed. */
let tokenized = 0;
const grammar = {
  tokenizeLine: (_text: string, stack: unknown) => {
    tokenized++;
    return { ruleStack: stack, tokens: [] };
  }
} as unknown as IGrammar;

/** A 2,500-line code file with a JSDoc fence opened at line 10 and never closed. */
const document = (
  version = 1,
  uri = "file:///long.ts"
): Parameters<InstanceType<typeof LineStates>["at"]>[0] =>
  ({
    uri: { toString: () => uri },
    version,
    lineCount: 2500,
    lineAt: (line: number) => ({
      text: line === 10 ? " * ```ts" : "// 日本語のコメント"
    })
  }) as never;

describe("rule stacks at checkpoints", () => {
  beforeEach(() => {
    tokenized = 0;
  });

  it("does not tokenize from the top of the file on every hover", () => {
    // WHY: the hover asks for the state at the hovered line, which used to mean tokenizing every
    // line above it — on every hover, with no debounce: ~140 ms at line 2,000 (audit P-4).
    const states = new LineStates();
    states.at(document(), grammar, 2000);
    expect(tokenized).toBe(2000);

    tokenized = 0;
    states.at(document(), grammar, 2000);
    expect(tokenized).toBeLessThan(100);

    tokenized = 0;
    states.at(document(), grammar, 2050);
    expect(tokenized).toBe(50);
  });

  it("starts over after an edit", () => {
    // WHY: one edit can change the state of every line below it — typing `/*` turns the rest of
    // the file into a comment — so a checkpoint from before it is wrong after it.
    const states = new LineStates();
    states.at(document(1), grammar, 2000);
    tokenized = 0;
    states.at(document(2), grammar, 2000);
    expect(tokenized).toBe(2000);
  });

  it("carries an open fence across a checkpoint", () => {
    // WHY: the fence is tracked beside the rule stack, so a checkpoint must keep it too. Otherwise a
    // code block opened above a checkpoint would be forgotten below it, and its code coloured as
    // prose.
    const states = new LineStates();
    expect(states.at(document(), grammar, 2000).fenced).toBe(true);
    expect(states.at(document(), grammar, 2050).fenced).toBe(true);
  });

  it("keeps each document's checkpoints apart", () => {
    // WHY: a checkpoint from one file is meaningless in another.
    const states = new LineStates();
    states.at(document(1, "file:///a.ts"), grammar, 2000);
    tokenized = 0;
    states.at(document(1, "file:///b.ts"), grammar, 2000);
    expect(tokenized).toBe(2000);
  });
});
