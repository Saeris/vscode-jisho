import { describe, expect, it, vi } from "vite-plus/test";

/**
 * A failed tokenizer build must not be cached for the session.
 *
 * Separate from tokenizer.spec.ts because it replaces Lindera with a fake: the real binding cannot be
 * made to fail on demand, and this module's cached build is per file.
 */
let builds = 0;
/** Every token a noun — enough to see a segment come back. */
const fakeTokenize = (
  text: string
): { surface: string; details: string[] }[] => [
  { surface: text, details: ["名詞", "一般"] }
];
vi.mock("lindera-nodejs", () => ({
  loadDictionary: () => {
    builds++;
    // The failure a Lindera bump causes: a dictionary compiled for another format.
    if (builds === 1)
      throw new Error(
        "Dictionary 'ipadic' has format version 1, but this build of Lindera reads format version 2."
      );
    return {};
  },
  loadUserDictionary: () => null,
  Metadata: class {},
  Tokenizer: class {
    readonly tokenize = fakeTokenize;
  }
}));

const { segment } = await import("../tokenizer");

describe("tokenizer recovery", () => {
  it("builds again after a failed build instead of failing for the rest of the session", async () => {
    // WHY: the build used to be cached even when it REJECTED, so one failure disabled the hover,
    // the decorations, search lemmas and the editor commands until VS Code reloaded — while the
    // database beside it retried on the next call (audit SM-5).
    await expect(segment("猫")).rejects.toThrow(/format version/u);
    await expect(segment("猫")).resolves.toEqual([
      expect.objectContaining({ surface: "猫", pos: "noun" })
    ]);
    expect(builds).toBe(2);
  });

  it("reuses a successful build", async () => {
    // WHY: retrying is for failures only; rebuilding a working tokenizer on every call would turn
    // a one-off ~30 ms cost into a per-hover one.
    await segment("犬");
    await segment("鳥");
    expect(builds).toBe(2);
  });
});
