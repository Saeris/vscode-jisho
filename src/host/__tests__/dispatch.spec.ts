import { describe, expect, it, vi } from "vite-plus/test";
import type { Handlers, Request, SegmentDto } from "../../shared/messages";
import type { Dictionary } from "../db";
import type { Remote } from "../remote";

// Only `openSettings`/`copyText` touch the vscode API, and neither is exercised here — but the
// module imports it at load, so it needs to resolve.
vi.mock("vscode", () => ({
  commands: { executeCommand: () => undefined },
  env: { clipboard: { writeText: async () => undefined } },
  window: { createOutputChannel: () => ({ appendLine: () => undefined }) }
}));

// `timed` writes to a vscode LogOutputChannel; the timing is not the subject here.
vi.mock("../log", () => ({
  timed: async <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn()
}));

// The tokenizer is the expensive dependency this module exists to gate, so it is the boundary:
// a real `segment()` would load a 12MB dictionary and make these tests about IPADIC.
const segmentMock = vi.fn<(text: string) => Promise<SegmentDto[]>>();
vi.mock("../tokenizer", () => ({
  segment: async (text: string) => segmentMock(text),
  contentSegmentCount: (segs: SegmentDto[]) =>
    segs.filter((s) => s.pos !== "particle" && s.pos !== "auxiliary").length
}));

const { answer, wordHandlers } = await import("../dispatch");

const seg = (
  surface: string,
  lemma: string,
  pos: SegmentDto["pos"]
): SegmentDto => ({ surface, lemma, reading: "", pos });

/**
 * A Dictionary stand-in recording what it was asked. Only `search` needs a real-ish return; the
 * rest exist so every request type can be dispatched.
 */
const fakeDict = () => {
  const calls: { search: { query: string; lemmas: string[] }[] } = {
    search: []
  };
  const dict = {
    search: async (query: string, _limit: number, lemmas: string[]) => {
      calls.search.push({ query, lemmas });
      return [];
    },
    searchKanji: async () => [],
    getWord: async () => null,
    getMoreExamples: async () => null,
    getKanji: async () => null,
    getComponentTree: async () => null,
    lookupRadicals: async () => ({ radicals: [], enabled: [], matches: [] }),
    getMeta: async () => ({})
  };
  return { dict, calls };
};

/** The fake exposes only the methods the handlers call, so it is widened rather than implemented. */
const asDict = (d: unknown): Remote<Dictionary> => d as Remote<Dictionary>;

/** The word handlers over a fake dictionary, with no names dictionary installed. */
const handlersFor = (dict: unknown): ReturnType<typeof wordHandlers> =>
  wordHandlers({
    dict: async () => asDict(dict),
    names: async () => ({ available: false, offered: false }),
    nameCounts: async () => ({})
  });

describe("dispatch: request/response correlation", () => {
  it("labels every answer with its request's type and requestId", async () => {
    // WHY: the webview bridge resolves its pending promises BY requestId and checks the type (see
    // bridge.ts). An answer that drops or mangles either never settles its caller — the UI just
    // spins, with no error anywhere. `answer` takes both from the request, so no handler can get
    // them wrong; this checks that it does, for every kind of word request.
    const { dict } = fakeDict();
    segmentMock.mockResolvedValue([]);
    // Only the word handlers are exercised; the rest of the table is never reached.
    const handlers = handlersFor(dict) as Handlers;

    const requests: Request[] = [
      { type: "search", requestId: "r1", query: "test" },
      { type: "getWord", requestId: "r2", id: "1" },
      { type: "getMoreExamples", requestId: "r3", id: "1" },
      { type: "getKanji", requestId: "r4", literal: "食" },
      { type: "getComponentTree", requestId: "r5", literal: "食" },
      { type: "lookupRadicals", requestId: "r6", selected: [] },
      { type: "getAbout", requestId: "r7" }
    ];

    for (const request of requests) {
      const response = await answer(handlers, request);
      expect(response.requestId).toBe(request.requestId);
      // The response type must match the request it answers, or the bridge hands the caller a
      // correctly-correlated payload of the wrong shape.
      expect(response.type).toBe(request.type);
    }
  });
});

describe("dispatch: a request the host cannot answer", () => {
  it("says to rebuild the host, instead of answering empty", async () => {
    // WHY: only a host older than its webview gets a request it has no handler for — in
    // development, after `vp build` without `vp pack`. It used to answer with an empty response,
    // which read exactly like a broken query and cost real debugging time (adding `kanjiList`).
    const { dict } = fakeDict();
    const handlers = handlersFor(dict) as Handlers;
    const unknown = {
      type: "notYetBuilt",
      requestId: "r"
    } as unknown as Request;
    await expect(answer(handlers, unknown)).rejects.toThrow(/vp pack/u);
  });
});

describe("dispatch: when a query gets tokenized", () => {
  it("does not tokenize English, romaji, or pure kana", async () => {
    // WHY: the first `segment()` call pays a WASM + 12MB IPADIC init, and `search` AWAITS it before
    // querying. Tokenizing input the tokenizer cannot help with would stall results on every
    // keystroke of an English search for nothing — the rule-based deinflection covers those.
    const { dict } = fakeDict();
    for (const query of ["eat", "taberu", "たべる", "食"]) {
      await handlersFor(dict).search({
        type: "search",
        requestId: "r",
        query
      });
    }
    expect(segmentMock).not.toHaveBeenCalled();
  });

  it("tokenizes mixed-script input and feeds its lemmas to search", async () => {
    // WHY: this is the whole point of the tokenizer on the search path — it resolves 食べました to
    // 食べる more accurately than the rule table, and `search` merges those lemmas as deinflection
    // candidates. If they stop being passed, conjugated queries quietly fall back to the weaker path.
    const { dict, calls } = fakeDict();
    segmentMock.mockResolvedValue([seg("食べました", "食べる", "verb")]);

    await handlersFor(dict).search({
      type: "search",
      requestId: "r",
      query: "食べました"
    });

    expect(segmentMock).toHaveBeenCalledWith("食べました");
    expect(calls.search[0]?.lemmas).toEqual(["食べる"]);
  });

  it("drops particles and auxiliaries from the lemmas", async () => {
    // WHY: を and します are not words anyone means to look up. Feeding them to search as candidates
    // would surface the particle entry above the noun the user typed.
    const { dict, calls } = fakeDict();
    segmentMock.mockResolvedValue([
      seg("日本語", "日本語", "noun"),
      seg("を", "を", "particle"),
      seg("勉強", "勉強", "noun"),
      seg("します", "する", "auxiliary")
    ]);

    await handlersFor(dict).search({
      type: "search",
      requestId: "r",
      query: "日本語を勉強します"
    });

    expect(calls.search[0]?.lemmas).toEqual(["日本語", "勉強"]);
  });

  it("does not pass the query back to itself as a lemma", async () => {
    // WHY: a single-word query tokenizes to its own lemma. Passing 食べる to a search FOR 食べる adds
    // a redundant candidate to the merge for every single-word lookup.
    const { dict, calls } = fakeDict();
    segmentMock.mockResolvedValue([seg("勉強", "勉強", "noun")]);

    await handlersFor(dict).search({
      type: "search",
      requestId: "r",
      query: "勉強"
    });

    expect(calls.search[0]?.lemmas).toEqual([]);
  });
});

describe("dispatch: the breakdown bar", () => {
  it("offers segments only when there is more than one content word", async () => {
    // WHY: the bar exists to split a SENTENCE into its words. Showing it for a single conjugated
    // word (食べました → 食べる) is a chip that just repeats the query, so the count that matters is
    // CONTENT words — particles do not make a sentence.
    const { dict } = fakeDict();

    segmentMock.mockResolvedValue([
      seg("食べました", "食べる", "verb"),
      seg("か", "か", "particle")
    ]);
    const single = await handlersFor(dict).search({
      type: "search",
      requestId: "r",
      query: "食べましたか"
    });
    expect(single).toMatchObject({ segments: [] });

    segmentMock.mockResolvedValue([
      seg("日本語", "日本語", "noun"),
      seg("を", "を", "particle"),
      seg("勉強", "勉強", "noun")
    ]);
    const sentence = await handlersFor(dict).search({
      type: "search",
      requestId: "r",
      query: "日本語を勉強"
    });
    expect(sentence).toMatchObject({ segments: expect.any(Array) });
    expect(sentence.segments).toHaveLength(3);
  });
});
