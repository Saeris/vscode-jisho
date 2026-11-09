/**
 * A value made on first use and shared after — and what happens when making it fails.
 *
 * The extension had four answers to "what happens after this fails once?" — retry, keep the
 * failure, degrade, keep a `null` — each chosen in its own file, and none stated where the value was
 * made (audit I-15). This states it at every use:
 *
 * - `"retry"` forgets a failure, so the next use tries again. For failures that can pass: a
 *   dictionary in the wrong format until it is rebuilt, a chunk that failed to load.
 * - `"keep"` keeps the failure, and every later use gets it at once. For failures that cannot pass
 *   in this session — a grammar no extension contributes, a WASM that will not instantiate — where
 *   retrying would repeat the same work on every keystroke and fail the same way.
 *
 * `reset()` starts over whatever the last outcome, for a value whose inputs changed.
 */
export type OnFailure = "retry" | "keep";

export interface Lazy<T> {
  /** The value, making it on first use. Every caller shares one attempt. */
  get: () => Promise<T>;
  /** Forget the value or failure; the next `get` makes it again. */
  reset: () => void;
}

export const lazy = <T>(
  make: () => Promise<T>,
  { onFailure }: { onFailure: OnFailure }
): Lazy<T> => {
  let current: Promise<T> | undefined;
  /** Which attempt `current` is, so a stale failure cannot forget a newer attempt. */
  let attempt = 0;

  // Its own async function so a `make` that throws SYNCHRONOUSLY still rejects later rather than
  // now: run inline, the `catch` below would fire before `current` was assigned, and a "retry"
  // failure would be kept after all.
  const run = async (): Promise<T> => make();

  const start = async (): Promise<T> => {
    const id = ++attempt;
    try {
      return await run();
    } catch (error) {
      if (onFailure === "retry" && attempt === id) current = undefined;
      throw error;
    }
  };

  return {
    get: async () => {
      current ??= start();
      return current;
    },
    reset: () => {
      attempt++;
      current = undefined;
    }
  };
};
