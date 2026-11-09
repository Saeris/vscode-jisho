import { describe, expect, it } from "vite-plus/test";
import {
  DictionaryError,
  DictionaryLifecycle,
  type LifecycleDeps
} from "../lifecycle";
import type { DictionaryStatus, FailureReason } from "../../shared/messages";

/** A database handle that records whether it was closed. */
interface FakeHandle {
  file: string;
  closed: boolean;
  close: () => Promise<void>;
}

/**
 * Deps whose every step is observable and controllable: provisioning can be held open or made to
 * download, and every open, close and rename is logged in order — which is what the update tests
 * assert on.
 */
const harness = (
  options: {
    exists?: boolean;
    download?: boolean;
    provision?: () => Promise<string>;
    open?: (path: string) => Promise<FakeHandle>;
    rename?: (from: string, to: string) => Promise<void>;
  } = {}
): {
  deps: LifecycleDeps<FakeHandle>;
  log: string[];
  statuses: DictionaryStatus[];
  finishDownload: () => void;
  provisions: () => number;
} => {
  const log: string[] = [];
  const statuses: DictionaryStatus[] = [];
  const downloaded = Promise.withResolvers<undefined>();
  let provisions = 0;
  const deps: LifecycleDeps<FakeHandle> = {
    exists: async () => options.exists ?? true,
    provision:
      options.provision ??
      (async (onProgress) => {
        provisions++;
        if (options.download) {
          onProgress(0);
          await downloaded.promise;
          onProgress(100);
        }
        return "/db/jisho.db";
      }),
    open:
      options.open ??
      (async (path) => {
        log.push(`open ${path}`);
        const handle: FakeHandle = {
          file: path,
          closed: false,
          close: async () => {
            handle.closed = true;
            log.push(`close ${path}`);
          }
        };
        return handle;
      }),
    rename:
      options.rename ??
      (async (from, to) => {
        log.push(`rename ${from} -> ${to}`);
      }),
    classify: (): FailureReason => "io",
    onStatus: (status) => statuses.push(status)
  };
  return {
    deps,
    log,
    statuses,
    finishDownload: () => downloaded.resolve(undefined),
    provisions: () => provisions
  };
};

describe("dictionary lifecycle", () => {
  it("answers not-ready while downloading instead of holding the request", async () => {
    // WHY: the first download is ~119 MB. A request held open for its whole length looks like a
    // search that never ends; answering `not-ready` lets the panel show progress instead.
    const h = harness({ download: true });
    const life = new DictionaryLifecycle(h.deps);
    const error = await life.acquire().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DictionaryError);
    expect((error as DictionaryError).code).toBe("not-ready");
    expect(life.status.state).toBe("downloading");

    h.finishDownload();
    await expect(life.install()).resolves.toMatchObject({ closed: false });
    expect(life.status.state).toBe("ready");
  });

  it("waits through a quick open rather than failing it", async () => {
    // WHY: opening takes milliseconds; failing a request for that would be needlessly fragile.
    const h = harness();
    const life = new DictionaryLifecycle(h.deps);
    await expect(life.acquire()).resolves.toMatchObject({
      file: "/db/jisho.db"
    });
    expect(life.status.state).toBe("ready");
  });

  it("keeps serving during an update and closes only at the swap", async () => {
    // WHY: this is the Windows update bug (audit SM-4). The update used to close the database
    // BEFORE a 119 MB download, so any hover during the download reopened it and the final rename
    // failed. Now the old handle keeps serving through the download, and is closed immediately
    // before the rename — and not reopened in between.
    const h = harness();
    const life = new DictionaryLifecycle(h.deps);
    const old = await life.acquire();
    h.log.length = 0;

    const midDownload: FakeHandle[] = [];
    await life.update(async (swap, onProgress) => {
      onProgress(50);
      // A hover during the download gets the OLD, still-open handle.
      midDownload.push(await life.acquire());
      h.log.push("download finished");
      await swap("/db/jisho.db.part", "/db/jisho.db");
    });

    expect(midDownload).toEqual([old]);
    expect(h.log).toEqual([
      "download finished",
      "close /db/jisho.db",
      "rename /db/jisho.db.part -> /db/jisho.db",
      "open /db/jisho.db"
    ]);
    expect(old.closed).toBe(true);
    expect(life.status).toEqual({ state: "ready" });
  });

  it("makes a request during the swap wait for the new file", async () => {
    // WHY: a request arriving between close and reopen must neither reopen the file being replaced
    // nor fail — it waits the fraction of a second the swap takes.
    const rename = Promise.withResolvers<undefined>();
    const h = harness({ rename: async () => rename.promise });
    const life = new DictionaryLifecycle(h.deps);
    await life.acquire();

    let during: Promise<FakeHandle> | undefined;
    const updating = life.update(async (swap) => {
      const swapping = swap("/db/jisho.db.part", "/db/jisho.db");
      during = life.acquire();
      rename.resolve(undefined);
      await swapping;
    });
    await updating;
    const handle = await during;
    expect(handle?.closed).toBe(false);
    expect(h.log.filter((l) => l.startsWith("open"))).toHaveLength(2);
  });

  it("keeps the dictionary working when the rename fails", async () => {
    // WHY: the old file is still in place after a failed rename. Reopening it means a failed update
    // costs the user nothing; leaving the handle closed would break every lookup.
    const h = harness({
      rename: async () => {
        throw new Error("EPERM: operation not permitted, rename");
      }
    });
    const life = new DictionaryLifecycle(h.deps);
    await life.acquire();
    await expect(
      life.update(async (swap) => swap("/db/jisho.db.part", "/db/jisho.db"))
    ).rejects.toThrow(/EPERM/u);
    expect(life.status.state).toBe("ready");
    await expect(life.acquire()).resolves.toMatchObject({ closed: false });
  });

  it("does not let a stale failure erase a newer open", async () => {
    // WHY: the old cache cleared itself on ANY failure, so an attempt that failed after a newer one
    // had started could erase it (audit SM-1). Only the current attempt may record a failure.
    const first = Promise.withResolvers<string>();
    let call = 0;
    const h = harness({
      provision: async () => {
        call++;
        return call === 1 ? first.promise : "/db/jisho.db";
      }
    });
    const life = new DictionaryLifecycle(h.deps);
    const stale = Promise.allSettled([life.acquire()]);
    await life.close();
    await expect(life.acquire()).resolves.toMatchObject({ closed: false });
    first.reject(new Error("the first attempt failed late"));
    await stale;
    expect(life.status.state).toBe("ready");
  });

  it("records a failure, then retries on the next request", async () => {
    // WHY: a failure is a state the panel can explain, not a permanent condition — the next
    // request (a "Try again") starts a fresh attempt.
    let fail = true;
    const h = harness({
      provision: async () => {
        if (fail) throw new Error("fetch failed");
        return "/db/jisho.db";
      }
    });
    const life = new DictionaryLifecycle(h.deps);
    await expect(life.acquire()).rejects.toBeInstanceOf(DictionaryError);
    expect(life.status).toMatchObject({ state: "failed", reason: "io" });
    fail = false;
    await expect(life.acquire()).resolves.toBeDefined();
    expect(life.status.state).toBe("ready");
  });

  it("never provisions when asked only for an installed dictionary", async () => {
    // WHY: names are opt-in (audit I-0). Reading them must not download them.
    const h = harness({ exists: false, download: true });
    const life = new DictionaryLifecycle(h.deps);
    await expect(life.acquireIfInstalled()).resolves.toBeUndefined();
    expect(h.provisions()).toBe(0);
    expect(life.status.state).toBe("absent");
  });
});
