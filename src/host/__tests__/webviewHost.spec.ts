import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * The webview host, driven through a fake view: what it delivers, when, and to which view.
 *
 * Everything around it is stubbed — the dictionaries, provisioning, logging — but the lifecycle and
 * the request routing are real, because those are what these tests are about.
 */

const names = vi.hoisted(() => ({ installed: false, provisions: 0 }));
const state = vi.hoisted(() => new Map<string, unknown>());

vi.mock("vscode", () => ({
  commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (_k: string, d: unknown) => d })
  },
  window: {},
  Uri: {
    // The fake context hands paths around as plain strings.
    joinPath: (...parts: string[]) => parts.join("/")
  }
}));
vi.mock("../log", () => ({
  mark: () => undefined,
  timed: async (_label: string, work: () => Promise<unknown>) => work(),
  log: () => ({ warn: () => undefined, info: () => undefined })
}));
vi.mock("../webviewHtml", () => ({ webviewHtml: () => "" }));
vi.mock("../tokenizer", () => ({
  segment: async () => [],
  warmTokenizer: async () => undefined,
  contentSegmentCount: () => 0
}));
vi.mock("../hostSettings", () => ({
  VIEW_ID: "jisho",
  currentSettings: () => ({}),
  isProse: () => true,
  codeCommentsEnabled: () => false,
  grammarEnabled: () => true
}));
vi.mock("../recentSearches", () => ({
  readRecent: () => [],
  recordRecent: async () => undefined,
  clearRecent: async () => undefined
}));
vi.mock("../ensureDatabase", () => ({
  wordDatabaseExists: async () => true,
  ensureDatabase: async () => "/storage/jisho.db",
  namesDatabaseExists: async () => names.installed,
  ensureNamesDatabase: async () => {
    names.provisions++;
    names.installed = true;
    return "/storage/jisho-names.db";
  }
}));
vi.mock("../db", () => ({
  SchemaVersionError: class extends Error {},
  Dictionary: {
    open: async () => ({
      close: async () => undefined,
      refineCounts: async () => ({}),
      getMeta: async () => ({})
    })
  }
}));
vi.mock("../names", () => ({
  NamesDictionary: {
    open: async () => ({
      close: async () => undefined,
      searchNames: async () => [{ id: "n1" }],
      browseNamesCount: async () => 1
    })
  }
}));

const { JishoViewProvider } = await import("../webviewHost");

/** A WebviewView whose visibility, messages and disposal the test controls. */
const fakeView = (): {
  view: never;
  posted: { type: string; [key: string]: unknown }[];
  send: (message: unknown) => Promise<void>;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
} => {
  const posted: { type: string; [key: string]: unknown }[] = [];
  let receive: (message: unknown) => void = () => undefined;
  let onVisibility: () => void = () => undefined;
  let onDispose: () => void = () => undefined;
  const view = {
    visible: true,
    webview: {
      options: {},
      html: "",
      postMessage: async (m: { type: string }) => {
        posted.push(m);
        return true;
      },
      onDidReceiveMessage: (fn: (m: unknown) => void) => {
        receive = fn;
      }
    },
    onDidDispose: (fn: () => void) => {
      onDispose = fn;
    },
    onDidChangeVisibility: (fn: () => void) => {
      onVisibility = fn;
    }
  };
  return {
    view: view as never,
    posted,
    // Requests are handled asynchronously; give the host a few turns to answer.
    send: async (message) => {
      receive(message);
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    setVisible: (visible) => {
      view.visible = visible;
      onVisibility();
    },
    dispose: () => onDispose()
  };
};

const context = (): never =>
  ({
    extensionUri: "/ext",
    globalStorageUri: "/storage",
    subscriptions: [],
    extension: { id: "saeris.vscode-jisho" },
    globalState: {
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      }
    }
  }) as never;

const answers = (posted: { type: string }[], type: string): number =>
  posted.filter((m) => m.type === type).length;

describe("webview host", () => {
  beforeEach(() => {
    names.installed = false;
    names.provisions = 0;
    state.clear();
  });

  it("holds an answer for a hidden panel and delivers it when shown", async () => {
    // WHY: the panel now keeps its context when hidden, but a hidden webview cannot receive
    // messages. An answer posted then used to be lost, and the request it answered stayed pending in
    // the webview for good.
    const provider = new JishoViewProvider(context());
    const { view, posted, send, setVisible } = fakeView();
    provider.resolveWebviewView(view);
    await send({ type: "webviewReady" });
    setVisible(false);
    await send({ type: "getRecentSearches", requestId: "a" });
    expect(answers(posted, "getRecentSearches")).toBe(0);
    setVisible(true);
    expect(answers(posted, "getRecentSearches")).toBe(1);
  });

  it("does not let an old view's dispose clear a newer one", async () => {
    // WHY: an old view's dispose arriving after a new view resolved used to clear the NEW one, so
    // everything after that was queued for a view that would never come (audit SM-2).
    const provider = new JishoViewProvider(context());
    const first = fakeView();
    const second = fakeView();
    provider.resolveWebviewView(first.view);
    provider.resolveWebviewView(second.view);
    await second.send({ type: "webviewReady" });
    first.dispose();
    provider.push({ type: "hostPush", action: "search", text: "猫" });
    expect(answers(second.posted, "hostPush")).toBe(1);
  });

  it("answers a names search without downloading names", async () => {
    // WHY: names are opt-in (audit I-0). The webview no longer asks before they are installed,
    // but a stale document or a race could — and the host must not download them on its behalf.
    const provider = new JishoViewProvider(context());
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);
    await send({ type: "webviewReady" });
    await send({ type: "searchNames", requestId: "n", query: "たなか" });
    expect(posted.find((m) => m.type === "searchNames")).toMatchObject({
      names: []
    });
    expect(names.provisions).toBe(0);
  });

  it("installs names only when asked, and searches them after", async () => {
    // WHY: the install is the one path allowed to download; after it, names must simply work.
    const provider = new JishoViewProvider(context());
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);
    await send({ type: "webviewReady" });
    await send({ type: "installNames", requestId: "i" });
    expect(names.provisions).toBe(1);
    await send({ type: "searchNames", requestId: "s", query: "たなか" });
    expect(posted.find((m) => m.type === "searchNames")).toMatchObject({
      names: [{ id: "n1" }]
    });
  });

  it("stops offering names once declined", async () => {
    // WHY: the offer sits under every search; declining must end it, everywhere, for good.
    const provider = new JishoViewProvider(context());
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);
    await send({ type: "webviewReady" });
    await send({ type: "browseCounts", requestId: "c1", applied: [] });
    await send({ type: "declineNames", requestId: "d" });
    await send({ type: "browseCounts", requestId: "c2", applied: [] });
    const counts = posted.filter((m) => m.type === "browseCounts");
    expect(counts.map((m) => m.namesOffered)).toEqual([true, false]);
  });
});
