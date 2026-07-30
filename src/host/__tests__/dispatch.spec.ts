import { describe, expect, it, vi } from "vitest";
import type { SegmentDto } from "../../shared/messages";
import type { Dictionary } from "../db";

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

const { respond } = await import("../dispatch");

/** The request subset `respond` accepts — narrower than `Request`, and not exported. */
type WordRequest = Parameters<typeof respond>[1];

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

/** The fake exposes only the methods `respond` calls, so it is widened rather than implemented. */
const asDict = (d: unknown): Dictionary => d as Dictionary;

describe("dispatch: request/response correlation", () => {
  it("echoes the requestId on every kind of response", async () => {
    // WHY: the webview bridge resolves its pending promises BY requestId (see bridge.ts). A response
    // that drops or mangles it never settles its caller — the UI just spins, with no error anywhere.
    // Every arm of the switch is mechanical enough to get this wrong when a new request type is
    // added, and nothing else in the system would notice.
    const { dict } = fakeDict();
    segmentMock.mockResolvedValue([]);

    const requests: WordRequest[] = [
      { type: "search", requestId: "r1", query: "test" },
      { type: "getWord", requestId: "r2", id: "1" },
      { type: "getMoreExamples", requestId: "r3", id: "1" },
      { type: "getKanji", requestId: "r4", literal: "食" },
      { type: "getComponentTree", requestId: "r5", literal: "食" },
      { type: "lookupRadicals", requestId: "r6", selected: [] },
      { type: "getAbout", requestId: "r7" }
    ];

    for (const request of requests) {
      const response = await respond(asDict(dict), request);
      expect(response.requestId).toBe(request.requestId);
      // The response type must match the request it answers, or the bridge hands the caller a
      // correctly-correlated payload of the wrong shape.
      expect(response.type).toBe(request.type);
    }
  });
});

describe("dispatch: when a query gets tokenized", () => {
  it("does not tokenize English, romaji, or pure kana", async () => {
    // WHY: the first `segment()` call pays a WASM + 12MB IPADIC init, and `search` AWAITS it before
    // querying. Tokenizing input the tokenizer cannot help with would stall results on every
    // keystroke of an English search for nothing — the rule-based deinflection covers those.
    const { dict } = fakeDict();
    for (const query of ["eat", "taberu", "たべる", "食"]) {
      await respond(asDict(dict), {
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

    await respond(asDict(dict), {
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

    await respond(asDict(dict), {
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

    await respond(asDict(dict), {
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
    const single = await respond(asDict(dict), {
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
    const sentence = await respond(asDict(dict), {
      type: "search",
      requestId: "r",
      query: "日本語を勉強"
    });
    expect(sentence).toMatchObject({ segments: expect.any(Array) });
    expect((sentence as { segments: SegmentDto[] }).segments).toHaveLength(3);
  });
});
