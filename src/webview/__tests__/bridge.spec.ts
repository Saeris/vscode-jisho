import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The bridge touches browser globals at import time (`acquireVsCodeApi`, `window`). Stub them
// before importing the module, and reset modules between tests so its internal pending-map is
// fresh each time.
type MessageListener = (event: { data: unknown }) => void;

const setup = async () => {
  const posted: unknown[] = [];
  const notifications: unknown[] = [];
  const listeners: MessageListener[] = [];

  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage: (m: unknown) => {
      // The bridge announces `webviewReady` at load; keep `posted` as requests only so tests can
      // index them positionally.
      if ((m as { type?: string }).type === "webviewReady")
        notifications.push(m);
      else posted.push(m);
    }
  }));
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: MessageListener) =>
      listeners.push(listener)
  });

  const bridge = await import("../bridge");
  // Simulate the host posting a message back to the webview by invoking the registered listeners.
  const deliver = (response: unknown): void => {
    for (const notify of listeners) notify({ data: response });
  };
  return { bridge, posted, notifications, deliver };
};

describe("webview bridge", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a search request with its correlated response", async () => {
    // WHY: the whole request/response model rests on matching a reply to its request by id;
    // if correlation broke, every query would hang or resolve with the wrong data.
    const { bridge, posted, deliver } = await setup();
    const promise = bridge.searchWords("eat");

    const sent = posted[0] as { type: string; requestId: string };
    expect(sent.type).toBe("search");
    deliver({
      type: "search",
      requestId: sent.requestId,
      results: [],
      kanji: [],
      segments: []
    });

    await expect(promise).resolves.toEqual({
      type: "search",
      requestId: sent.requestId,
      results: [],
      kanji: [],
      segments: []
    });
  });

  it("routes concurrent responses to the matching request", async () => {
    // WHY: the user can fire overlapping lookups (fast typing, tapping xrefs); responses may arrive
    // out of order and must still land on the right promise, keyed by requestId.
    const { bridge, posted, deliver } = await setup();
    const search = bridge.searchWords("eat");
    const word = bridge.getWord("123");

    const first = posted[0] as { requestId: string };
    const second = posted[1] as { requestId: string };

    // Deliver in reverse order.
    deliver({ type: "getWord", requestId: second.requestId, word: null });
    deliver({
      type: "search",
      requestId: first.requestId,
      results: [],
      kanji: [],
      segments: []
    });

    await expect(word).resolves.toMatchObject({ type: "getWord", word: null });
    await expect(search).resolves.toMatchObject({
      type: "search",
      results: []
    });
  });

  it("rejects when the host returns an error response", async () => {
    // WHY: a host-side failure (e.g. DB not provisioned) must surface as a rejected query so the UI
    // shows an error instead of spinning forever.
    const { bridge, posted, deliver } = await setup();
    const promise = bridge.getWord("123");
    const sent = posted[0] as { requestId: string };
    deliver({ type: "error", requestId: sent.requestId, message: "boom" });
    await expect(promise).rejects.toThrow("boom");
  });
});

describe("host pushes", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces readiness on load so queued editor commands can flush", async () => {
    // WHY: a push posted before the bridge attaches is silently lost — the host queues until this
    // notification, so a command issued with the sidebar closed still lands.
    const { notifications } = await setup();
    expect(notifications).toEqual([{ type: "webviewReady" }]);
  });

  it("routes host pushes to subscribers, outside the request correlation", async () => {
    // WHY: pushes have no requestId; if they fell into the correlation path they'd be dropped,
    // and if responses reached push handlers every query would double-fire an action.
    const { bridge, deliver } = await setup();
    const seen: unknown[] = [];
    const unsubscribe = bridge.onHostPush((p) => seen.push(p));
    deliver({ type: "hostPush", action: "search", text: "食べる" });
    deliver({ type: "notAPush", something: 1 });
    expect(seen).toEqual([
      { type: "hostPush", action: "search", text: "食べる" }
    ]);
    unsubscribe();
    deliver({ type: "hostPush", action: "speak", text: "x" });
    expect(seen).toHaveLength(1);
  });
});

describe("host settings", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes settings snapshots to subscribers, outside the request correlation", async () => {
    // WHY: settings are pushed (initial + on every Settings-UI edit), not requested — if they fell
    // into the correlation path they'd be dropped as unmatched responses.
    const { bridge, deliver } = await setup();
    const seen: unknown[] = [];
    bridge.onHostSettings((s) => seen.push(s));
    deliver({
      type: "hostSettings",
      settings: { textScale: 1.5, guideStyle: "aligned" }
    });
    expect(seen).toEqual([{ textScale: 1.5, guideStyle: "aligned" }]);
  });
});
