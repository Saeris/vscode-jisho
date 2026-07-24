import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the slice of the vscode API dictionaryUpdate uses. Files are keyed by
// fsPath; directory listings are derived from the keys under /storage.
const files = new Map<string, string>();

const uri = (fsPath: string) => ({ fsPath, toString: () => fsPath });

// Mutable test doubles the mock reads from, reset per test.
const state = {
  infoMessages: [] as string[],
  warnMessages: [] as string[],
  // Response to each info prompt in order (the update flow shows two: "Update?" then "Reload?").
  // A single value repeats for every prompt.
  infoResponse: undefined as string | undefined,
  infoResponses: [] as string[],
  config: new Map<string, unknown>(),
  configUpdates: [] as { key: string; value: unknown }[],
  globalState: new Map<string, unknown>(),
  executedCommands: [] as string[]
};

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) =>
      uri([base.fsPath, ...parts].join("/"))
  },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  FileType: { File: 1, Directory: 2 },
  window: {
    withProgress: async (
      _opts: unknown,
      task: (p: { report: () => void }) => Promise<unknown>
    ) => task({ report: () => undefined }),
    showInformationMessage: async (message: string, ..._items: string[]) => {
      state.infoMessages.push(message);
      return state.infoResponses.length > 0
        ? state.infoResponses.shift()
        : state.infoResponse;
    },
    showWarningMessage: async (message: string) => {
      state.warnMessages.push(message);
      return undefined;
    }
  },
  commands: {
    executeCommand: async (command: string) => {
      state.executedCommands.push(command);
    }
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) =>
        state.config.has(key) ? state.config.get(key) : fallback,
      update: async (key: string, value: unknown) => {
        state.configUpdates.push({ key, value });
      }
    }),
    fs: {
      stat: async (u: { fsPath: string }) => {
        if (!files.has(u.fsPath)) throw new Error("ENOENT");
        return { type: 1 };
      },
      readDirectory: async (dir: { fsPath: string }) => {
        const prefix = `${dir.fsPath}/`;
        return [...files.keys()]
          .filter(
            (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")
          )
          .map((p) => [p.slice(prefix.length), 1] as [string, number]);
      },
      delete: async (u: { fsPath: string }) => {
        if (!files.delete(u.fsPath)) throw new Error("ENOENT");
      }
    }
  }
}));

const downloadMock = vi.fn<(destPath: string) => Promise<string>>(
  async (destPath) => {
    files.set(destPath, "downloaded");
    return "remote";
  }
);
let remoteVersion: string | undefined = "full 2026-08-01";
vi.mock("../download", () => ({
  DATA_RELEASE_BASE: "https://example.test/release",
  downloadDatabase: async (destPath: string) => downloadMock(destPath),
  fetchRemoteVersion: async () => remoteVersion,
  readVersionSidecar: async (dbPath: string) => files.get(`${dbPath}.version`)
}));

const { checkForDictionaryUpdate, sweepDictionaryStorage } =
  await import("../dictionaryUpdate");

const context = {
  globalStorageUri: uri("/storage"),
  extensionUri: uri("/ext"),
  globalState: {
    get: (key: string, fallback: unknown) =>
      state.globalState.has(key) ? state.globalState.get(key) : fallback,
    update: async (key: string, value: unknown) => {
      state.globalState.set(key, value);
    }
  }
} as never;

const CACHED_DB = "/storage/jisho.db";
const CACHED_VERSION = "/storage/jisho.db.version";
const BUNDLED_DB = "/ext/assets/jisho.db";

describe("dictionaryUpdate", () => {
  beforeEach(() => {
    files.clear();
    state.infoMessages = [];
    state.warnMessages = [];
    state.infoResponse = undefined;
    state.infoResponses = [];
    state.config = new Map();
    state.configUpdates = [];
    state.globalState = new Map();
    state.executedCommands = [];
    remoteVersion = "full 2026-08-01";
    downloadMock.mockClear();
  });

  describe("checkForDictionaryUpdate", () => {
    it("never prompts against a bundled (dev) dictionary", async () => {
      // WHY: F5 dev refreshes from assets/ automatically; an "update available" prompt there is noise
      // and would point at a release the dev build doesn't use.
      files.set(BUNDLED_DB, "db");
      files.set(CACHED_VERSION, "full 2026-07-01"); // even with an "older" cached version
      await checkForDictionaryUpdate(context, { manual: false });
      expect(state.infoMessages).toHaveLength(0);
    });

    it("offers to update when the release has a newer version", async () => {
      // WHY: the core of the feature — a newer data version must surface as a (dismissible) prompt.
      files.set(CACHED_VERSION, "full 2026-07-01");
      state.infoResponse = "Later"; // dismiss without downloading
      await checkForDictionaryUpdate(context, { manual: false });
      expect(
        state.infoMessages.some((m) => m.includes("newer dictionary"))
      ).toBe(true);
      expect(downloadMock).not.toHaveBeenCalled();
    });

    it("throttles the automatic check to once per 24h", async () => {
      // WHY: an activation-frequency network check is wasteful; the throttle makes it daily. A check
      // that ran an hour ago must not fetch again.
      files.set(CACHED_VERSION, "full 2026-07-01");
      state.globalState.set(
        "dictionary.lastUpdateCheck",
        Date.now() - 60 * 60 * 1000 // 1h ago
      );
      await checkForDictionaryUpdate(context, { manual: false });
      expect(state.infoMessages).toHaveLength(0);
    });

    it("ignores the throttle for a manual check", async () => {
      // WHY: the user explicitly asking must always run, regardless of when the last auto-check was.
      files.set(CACHED_VERSION, "full 2026-07-01");
      state.globalState.set("dictionary.lastUpdateCheck", Date.now());
      state.infoResponse = "Later";
      await checkForDictionaryUpdate(context, { manual: true });
      expect(
        state.infoMessages.some((m) => m.includes("newer dictionary"))
      ).toBe(true);
    });

    it("respects the autoCheck opt-out for the automatic path only", async () => {
      // WHY: "Never" disables the automatic prompt; but a manual check must still work afterward.
      files.set(CACHED_VERSION, "full 2026-07-01");
      state.config.set("vscode-jisho.dictionary.autoCheck", false);

      await checkForDictionaryUpdate(context, { manual: false });
      expect(state.infoMessages).toHaveLength(0); // auto path suppressed

      state.infoResponse = "Later";
      await checkForDictionaryUpdate(context, { manual: true });
      expect(
        state.infoMessages.some((m) => m.includes("newer dictionary"))
      ).toBe(true); // manual still runs
    });

    it("writes the opt-out setting when the user picks Never", async () => {
      // WHY: "Never" must persist so the daily prompt stops — a prompt that keeps reappearing after
      // "Never" is exactly the nag the dismissible model is meant to avoid.
      files.set(CACHED_VERSION, "full 2026-07-01");
      state.infoResponse = "Never";
      await checkForDictionaryUpdate(context, { manual: false });
      expect(state.configUpdates).toContainEqual({
        key: "vscode-jisho.dictionary.autoCheck",
        value: false
      });
    });

    it("reports up-to-date on a manual check but stays silent automatically", async () => {
      // WHY: a manual check should confirm "nothing to do"; the automatic one must never interrupt
      // when there's no news.
      files.set(CACHED_VERSION, "full 2026-08-01"); // same as remote
      await checkForDictionaryUpdate(context, { manual: false });
      expect(state.infoMessages).toHaveLength(0);

      await checkForDictionaryUpdate(context, { manual: true });
      expect(state.infoMessages.some((m) => m.includes("up to date"))).toBe(
        true
      );
    });

    it("stays silent when the release is unreachable (offline)", async () => {
      // WHY: offline-first — a failed version fetch must never surface as an error on the auto path.
      files.set(CACHED_VERSION, "full 2026-07-01");
      remoteVersion = undefined;
      await checkForDictionaryUpdate(context, { manual: false });
      expect(state.infoMessages).toHaveLength(0);
      expect(state.warnMessages).toHaveLength(0);
    });

    it("downloads and offers a reload when the user accepts the update", async () => {
      // WHY: accepting must actually re-download and prompt a reload so the new (possibly reshaped) DB
      // is reopened. The download is atomic (download.ts), so the working DB is safe if it fails.
      files.set(CACHED_VERSION, "full 2026-07-01");
      state.infoResponses = ["Update", "Reload"]; // accept the update, then accept the reload
      await checkForDictionaryUpdate(context, { manual: false });
      expect(downloadMock).toHaveBeenCalledWith(CACHED_DB);
      expect(state.executedCommands).toContain("workbench.action.reloadWindow");
    });
  });

  describe("sweepDictionaryStorage", () => {
    it("deletes orphaned DBs and stale .part files, keeps the active ones", async () => {
      // WHY: a schema-version upgrade orphans the old ~400MB DB, and interrupted downloads leave .part
      // files — both are dead weight. But the active word DB, its sidecar, and an opt-in names DB must
      // survive (deleting the names DB would force an unwanted re-download of a feature the user chose).
      files.set(CACHED_DB, "active");
      files.set(CACHED_VERSION, "full 2026-08-01");
      files.set("/storage/jisho-names.db", "names");
      files.set("/storage/jisho-names.db.version", "names v1");
      files.set("/storage/jisho-full.db@v1.db", "orphan"); // superseded by an upgrade
      files.set("/storage/jisho.db.part", "interrupted"); // stale download
      files.set("/storage/unrelated.txt", "not ours"); // must not be touched

      await sweepDictionaryStorage(context);

      expect(files.has(CACHED_DB)).toBe(true);
      expect(files.has(CACHED_VERSION)).toBe(true);
      expect(files.has("/storage/jisho-names.db")).toBe(true);
      expect(files.has("/storage/jisho-names.db.version")).toBe(true);
      expect(files.has("/storage/jisho-full.db@v1.db")).toBe(false);
      expect(files.has("/storage/jisho.db.part")).toBe(false);
      expect(files.has("/storage/unrelated.txt")).toBe(true);
    });

    it("is a no-op when the storage directory has nothing of ours", async () => {
      // WHY: on a fresh install (nothing downloaded yet) the sweep must not throw or delete anything.
      files.set("/storage/other.log", "x");
      await sweepDictionaryStorage(context);
      expect(files.has("/storage/other.log")).toBe(true);
    });
  });
});
