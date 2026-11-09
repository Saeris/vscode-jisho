/**
 * One dictionary database's lifecycle, as an explicit state machine.
 *
 * This replaces state that lived in five places — two cached promises in the webview host, a
 * `closeDatabases` callback, the update's close-then-download order, and `ensureDatabase` calls
 * scattered through the request path — none of which knew what the others were doing. The audit found
 * the consequences (SM-1, SM-4, SM-10): an update that closed the database BEFORE a 119 MB download
 * let any hover reopen it, so the final rename failed on Windows; a failed open could erase a newer
 * one; and the webview could not tell "downloading" from "broken".
 *
 *   absent ──acquire──▶ downloading(%) ──▶ opening ──▶ ready ◀──────────┐
 *     ▲                     │                │          │ update      │
 *     │                     └──────┬─────────┘          ▼             │
 *     │                            ▼                 ready(updating%) │
 *     └────── retry ──────── failed(reason)             │ downloaded  │
 *                                                       ▼             │
 *                                                    swapping ────────┘
 *
 * Three rules carry the fixes:
 *
 * - **An update downloads while the database keeps serving.** The old file stays open through the
 *   whole download; only the swap — close, rename, reopen — interrupts it, for well under a second.
 *   Requests that arrive during the swap WAIT for it rather than reopening the file being replaced.
 * - **A request never waits on a download.** While downloading, `acquire` rejects at once with
 *   `not-ready`; the webview shows progress and refreshes when the state reaches `ready`.
 * - **A failure clears only its own attempt.** A failed open cannot erase a newer one that started
 *   after it.
 *
 * Pure: everything that touches the filesystem, the network or VS Code is injected, so every
 * transition is unit-tested without them.
 */
import type {
  DictionaryErrorCode,
  DictionaryStatus,
  FailureReason
} from "../shared/messages";

/** A request could not be served because of the dictionary's state, not because of a bug. */
export class DictionaryError extends Error {
  readonly code: DictionaryErrorCode;

  constructor(code: DictionaryErrorCode, message: string) {
    super(message);
    this.name = "DictionaryError";
    this.code = code;
  }
}

/** Anything the lifecycle can hold open. */
export interface Closable {
  close: () => Promise<void>;
}

/** Replace the file at `dest` with the downloaded `part`. Supplied by the lifecycle to a download. */
export type Swap = (part: string, dest: string) => Promise<void>;

export interface LifecycleDeps<Handle extends Closable> {
  /** Whether the database is on disk. Never downloads. */
  exists: () => Promise<boolean>;
  /** Make the database exist, downloading it if needed, and return its path. */
  provision: (onProgress: (percent: number) => void) => Promise<string>;
  open: (path: string) => Promise<Handle>;
  /** Move the downloaded file into place. `node:fs/promises.rename` in production. */
  rename: (from: string, to: string) => Promise<void>;
  /** Classify a failure, so the webview can offer the recovery that fits it. */
  classify: (error: unknown) => FailureReason;
  /** Told about every state change. */
  onStatus: (status: DictionaryStatus) => void;
}

/** What `failed(reason)` tells the user, as a request error's message. */
const FAILURE_MESSAGE: Record<FailureReason, string> = {
  offline: "Couldn't download the dictionary.",
  "schema-older": "This dictionary is older than this version of Jisho.",
  "schema-newer": "This dictionary needs a newer version of Jisho.",
  io: "Jisho couldn't open its dictionary."
};

/** Await a promise only to keep its rejection from going unhandled; the caller has moved on. */
const ignore = async (promise: Promise<unknown>): Promise<void> => {
  try {
    await promise;
  } catch {
    // Recorded in the lifecycle's state already; nobody is waiting for it here.
  }
};

export class DictionaryLifecycle<Handle extends Closable> {
  readonly #deps: LifecycleDeps<Handle>;
  #status: DictionaryStatus = { state: "absent" };
  #handle: Handle | undefined;
  /** The provision-and-open in flight, if any. Rejects with a `DictionaryError`. */
  #attempt: Promise<Handle> | undefined;
  /** Identifies the current attempt, so a stale one can tell it has been superseded. */
  #attemptId = 0;
  /** The swap in flight, if any — requests wait on it rather than reopening the file. */
  #swap: Promise<unknown> | undefined;
  /** Waiters to reject the moment a download starts — see `acquire`. */
  readonly #onDownloading = new Set<() => void>();

  constructor(deps: LifecycleDeps<Handle>) {
    this.#deps = deps;
  }

  get status(): DictionaryStatus {
    return this.#status;
  }

  #set(status: DictionaryStatus): void {
    this.#status = status;
    this.#deps.onStatus(status);
    if (status.state === "downloading") {
      for (const notify of this.#onDownloading) notify();
      this.#onDownloading.clear();
    }
  }

  /**
   * The open database, provisioning it if it is absent or failed.
   *
   * Rejects with `not-ready` while downloading, so no request holds a connection open for minutes;
   * waits while opening or swapping, which take milliseconds.
   */
  async acquire(): Promise<Handle> {
    if (this.#swap) await this.#swap;
    if (this.#status.state === "ready" && this.#handle) return this.#handle;
    if (this.#status.state === "downloading") throw this.#notReady();
    const attempt = this.#attempt ?? this.#start();
    // Checked AFTER starting, as well as listened for: provisioning can report a download
    // synchronously, inside `#start`, before a listener exists — which left a request waiting out
    // the whole download.
    if (this.#isDownloading()) {
      // The attempt carries on in the background; this request just stops waiting for it.
      void ignore(attempt);
      throw this.#notReady();
    }
    // If a download starts while this request waits, answer `not-ready` at once instead of holding
    // the request for the whole download.
    const { promise: downloading, reject } = Promise.withResolvers<never>();
    const notify = (): void => reject(this.#notReady());
    this.#onDownloading.add(notify);
    try {
      return await Promise.race([attempt, downloading]);
    } finally {
      this.#onDownloading.delete(notify);
    }
  }

  /** The open database if it is installed (or opening), else `undefined`. Never downloads. */
  async acquireIfInstalled(): Promise<Handle | undefined> {
    if (this.#handle || this.#attempt || this.#swap) return this.acquire();
    if (!(await this.#deps.exists())) return undefined;
    return this.acquire();
  }

  /**
   * Provision and open, WAITING through any download. For an install the user asked for, where
   * holding the request until it is done is the point.
   */
  async install(): Promise<Handle> {
    if (this.#swap) await this.#swap;
    if (this.#status.state === "ready" && this.#handle) return this.#handle;
    return this.#attempt ?? this.#start();
  }

  async #start(): Promise<Handle> {
    const id = ++this.#attemptId;
    const current = (): boolean => this.#attemptId === id;
    const run = async (): Promise<Handle> => {
      this.#set({ state: "opening" });
      const path = await this.#deps.provision((percent) => {
        if (current()) this.#set({ state: "downloading", percent });
      });
      if (current()) this.#set({ state: "opening" });
      return this.#deps.open(path);
    };
    const attempt: Promise<Handle> = (async (): Promise<Handle> => {
      try {
        const handle = await run();
        if (!current()) {
          // Superseded — closed while it was opening. Release what it opened rather than leak it.
          await handle.close();
          throw new DictionaryError("not-ready", "The dictionary was closed.");
        }
        this.#handle = handle;
        this.#attempt = undefined;
        this.#set({ state: "ready" });
        return handle;
      } catch (error) {
        if (error instanceof DictionaryError) throw error;
        const reason = this.#deps.classify(error);
        const detail = error instanceof Error ? error.message : String(error);
        // Only the current attempt may record a failure: a stale one must not overwrite a newer
        // attempt's state, which is how a failed open used to erase a successful one.
        if (current()) {
          this.#attempt = undefined;
          this.#set({ state: "failed", reason, message: detail });
        }
        throw new DictionaryError(
          reason,
          `${FAILURE_MESSAGE[reason]} ${detail}`
        );
      }
    })();
    this.#attempt = attempt;
    return attempt;
  }

  /** A method rather than an inline check, so TypeScript does not carry an earlier narrowing past
   *  a call that changes the state. */
  #isDownloading(): boolean {
    return this.#status.state === "downloading";
  }

  #notReady(): DictionaryError {
    const percent =
      this.#status.state === "downloading" ? ` (${this.#status.percent}%)` : "";
    return new DictionaryError(
      "not-ready",
      `The dictionary is still downloading${percent}.`
    );
  }

  /**
   * Replace the open database with a newer download, keeping it in service until the swap.
   *
   * `download` writes the new file beside the old one and calls the `swap` it is given once the file
   * is verified. Only then is the old handle closed — immediately before the rename, which is what
   * Windows needs — and requests arriving during the swap wait for the new handle.
   */
  async update(
    download: (
      swap: Swap,
      onProgress: (percent: number) => void
    ) => Promise<void>
  ): Promise<void> {
    if (this.#status.state !== "ready" || !this.#handle) {
      throw new DictionaryError(
        "not-ready",
        "The dictionary can only be updated once it is open."
      );
    }
    const swap: Swap = async (part, dest) => {
      const { promise, resolve } = Promise.withResolvers<undefined>();
      this.#swap = promise;
      this.#set({ state: "swapping" });
      try {
        await this.#handle?.close();
        this.#handle = undefined;
        try {
          await this.#deps.rename(part, dest);
        } finally {
          // Reopen whichever file is there now: the new one, or — if the rename failed — the old
          // one, still in place. Either way the dictionary keeps working.
          this.#handle = await this.#deps.open(dest);
          this.#set({ state: "ready" });
        }
      } catch (error) {
        if (!this.#handle) {
          this.#set({
            state: "failed",
            reason: this.#deps.classify(error),
            message: error instanceof Error ? error.message : String(error)
          });
        }
        throw error;
      } finally {
        this.#swap = undefined;
        resolve(undefined);
      }
    };
    // A function rather than an inline check: TypeScript keeps the `ready` narrowing from the guard
    // above across the `await`, but the state really does change during a download.
    const serving = (): boolean => this.#status.state === "ready";
    await download(swap, (percent) => {
      if (serving()) this.#set({ state: "ready", updating: percent });
    });
    // Clear the progress, whether or not the download reached the swap.
    if (serving()) this.#set({ state: "ready" });
  }

  /** Close the database. The next `acquire` opens it again. */
  async close(): Promise<void> {
    if (this.#swap) await this.#swap;
    const handle = this.#handle;
    this.#handle = undefined;
    this.#attempt = undefined;
    // An open in flight is now stale: it will close what it opens instead of installing it.
    this.#attemptId++;
    this.#set({ state: "absent" });
    await handle?.close();
  }
}
