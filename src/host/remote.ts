/**
 * The main-thread side of `dictionaryWorker.ts`: a typed stand-in for a dictionary that lives in a
 * worker thread.
 *
 * Every async method of the dictionary becomes a message to the worker and back, so callers keep
 * calling `dict.search(...)` exactly as before — and the query no longer runs on the thread every
 * extension shares. `close()` closes the database and ends the worker, which releases the file.
 *
 * A worker can also stop on its own, which an in-process database never did. Then every call —
 * waiting or new — rejects at once rather than waiting for an answer that cannot come, and `onLost`
 * tells the owner, so the next request opens a new worker.
 */
import { Worker } from "node:worker_threads";
import { SchemaVersionError } from "./db";
import type { Closable } from "./lifecycle";

export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown[];
}

export type WorkerReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: SerializedError };

export interface SerializedError {
  name: string;
  message: string;
  /** The worker's stack, so a crash report points at the query that failed, not at this file. */
  stack?: string;
  /** Present for a schema mismatch, so the main thread can rebuild it and classify the failure. */
  expected?: number;
  found?: number;
}

/** A dictionary's async methods, called across the worker boundary. */
export type Remote<T> = {
  [
    K in keyof T as T[K] extends (...args: never[]) => Promise<unknown>
      ? K
      : never
  ]: T[K];
} & Closable;

/** Rebuild an error from the worker, keeping the type the failure classifier looks for. */
const revive = (error: SerializedError): Error => {
  const revived =
    error.expected !== undefined && error.found !== undefined
      ? new SchemaVersionError(error.expected, error.found)
      : Object.assign(new Error(error.message), { name: error.name });
  if (error.stack !== undefined) revived.stack = error.stack;
  return revived;
};

/**
 * Open the `kind` database at `path` in a worker running `script`, and return its stand-in.
 *
 * Rejects as opening the database directly would — including a `SchemaVersionError` — so the
 * dictionary lifecycle classifies a failed open exactly as before.
 */
export const openRemote = async <T>(
  script: string,
  kind: "words" | "names",
  path: string,
  onLost?: () => void
): Promise<Remote<T>> => {
  const worker = new Worker(script, { workerData: { kind, path } });
  // A dictionary nobody is querying must never keep the extension host alive.
  worker.unref();

  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  /** Set once the worker has exited; every call after that rejects with it. */
  let stopped: Error | undefined;
  let opened = false;
  let closing = false;

  const failAll = (error: Error): void => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  worker.on("message", (reply: WorkerReply) => {
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(revive(reply.error));
  });
  worker.on("error", failAll);
  worker.on("exit", () => {
    stopped = new Error("The dictionary worker stopped.");
    failAll(stopped);
    // Only an exit nobody asked for is a loss: not a failed open (that rejects below), and not
    // `close()`.
    if (opened && !closing) onLost?.();
  });

  const call = async (method: string, args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (stopped) {
        reject(stopped);
        return;
      }
      const id = method === "#open" ? 0 : nextId++;
      pending.set(id, { resolve, reject });
      if (id !== 0)
        worker.postMessage({ id, method, args } satisfies WorkerRequest);
    });

  // The worker reports the open as reply 0; wait for it, so a failed open rejects HERE.
  try {
    await call("#open", []);
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  opened = true;

  const close = async (): Promise<void> => {
    if (stopped) return;
    closing = true;
    try {
      await call("close", []);
    } finally {
      // Ends the thread, which is what releases the database file for good.
      await worker.terminate();
    }
  };

  const stand = new Proxy(
    {},
    {
      get: (
        _target,
        property
      ): ((...args: unknown[]) => Promise<unknown>) | undefined => {
        if (property === "close") return close;
        // Never thenable: `await remote` must not mistake this for a promise and call `.then`.
        if (property === "then" || typeof property === "symbol")
          return undefined;
        return async (...args: unknown[]): Promise<unknown> =>
          call(property, args);
      }
    }
  );
  // The one assertion the boundary needs: a Proxy cannot be typed from its handler. Every property
  // it answers is either `close` or a method forwarded to the worker, which is what `Remote<T>` says.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return stand as Remote<T>;
};
