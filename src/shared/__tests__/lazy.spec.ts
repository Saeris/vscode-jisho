import { describe, expect, it } from "vite-plus/test";
import { lazy } from "../lazy";

/** A factory that counts its calls and fails while `failing` is set. */
const factory = (): {
  make: () => Promise<string>;
  calls: () => number;
  setFailing: (failing: boolean) => void;
} => {
  let calls = 0;
  let failing = false;
  return {
    make: async () => {
      calls++;
      if (failing) throw new Error(`attempt ${calls} failed`);
      return `value ${calls}`;
    },
    calls: () => calls,
    setFailing: (next) => {
      failing = next;
    }
  };
};

describe("lazy values", () => {
  it("makes the value once for every caller", async () => {
    // WHY: the values behind this are expensive — a tokenizer dictionary, a 6.7 MB chunk, a grammar.
    // Two callers in the same moment must share one attempt, not start two.
    const f = factory();
    const value = lazy(f.make, { onFailure: "retry" });
    const [a, b] = await Promise.all([value.get(), value.get()]);
    expect([a, b]).toEqual(["value 1", "value 1"]);
    expect(f.calls()).toBe(1);
  });

  it("tries again after a failure, when told to retry", async () => {
    // WHY: one failed tokenizer build used to disable the hover, the colouring and the editor
    // commands until VS Code reloaded (audit SM-5), for a failure that a rebuild fixes.
    const f = factory();
    f.setFailing(true);
    const value = lazy(f.make, { onFailure: "retry" });
    await expect(value.get()).rejects.toThrow("attempt 1 failed");
    f.setFailing(false);
    await expect(value.get()).resolves.toBe("value 2");
  });

  it("forgets a failure thrown before the first await, too", async () => {
    // WHY: a factory that throws synchronously would otherwise fail before its promise was stored,
    // and "retry" would keep that failure after all.
    let calls = 0;
    // A plain function, not `async`: the point is a throw that happens before any promise exists,
    // which `async` would turn into a rejection.
    // oxlint-disable-next-line typescript/promise-function-async
    const make = (): Promise<string> => {
      calls++;
      if (calls === 1) throw new Error("synchronous");
      return Promise.resolve("made");
    };
    const value = lazy(make, { onFailure: "retry" });
    await expect(value.get()).rejects.toThrow("synchronous");
    await expect(value.get()).resolves.toBe("made");
  });

  it("keeps a failure, when told to", async () => {
    // WHY: some failures cannot pass in a session (a grammar no extension contributes). Retrying
    // those would redo the same failing work on every keystroke.
    const f = factory();
    f.setFailing(true);
    const value = lazy(f.make, { onFailure: "keep" });
    await expect(value.get()).rejects.toThrow("attempt 1 failed");
    f.setFailing(false);
    await expect(value.get()).rejects.toThrow("attempt 1 failed");
    expect(f.calls()).toBe(1);
  });

  it("starts over on reset, and a stale failure cannot undo that", async () => {
    // WHY: `reset` is for inputs that changed (the OS voices). An attempt from before it that fails
    // late must not erase the newer attempt.
    let rejectFirst: (error: Error) => void = () => undefined;
    let calls = 0;
    const value = lazy(
      async () => {
        calls++;
        if (calls === 1) {
          return new Promise<string>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        return "fresh";
      },
      { onFailure: "retry" }
    );
    const stale = value.get();
    value.reset();
    await expect(value.get()).resolves.toBe("fresh");
    rejectFirst(new Error("late"));
    await expect(stale).rejects.toThrow("late");
    await expect(value.get()).resolves.toBe("fresh");
    expect(calls).toBe(2);
  });
});
