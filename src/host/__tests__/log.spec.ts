import { beforeEach, describe, expect, it, vi } from "vitest";

// The log channel is the only piece of `vscode` this module touches. Capturing the lines lets the
// tests assert that a failure is still reported rather than silently swallowed.
const lines: string[] = [];

vi.mock("vscode", () => ({
  window: {
    createOutputChannel: () => ({
      info: (message: string) => lines.push(`info ${message}`),
      error: (message: string) => lines.push(`error ${message}`)
    })
  }
}));

const { beginTrace, formatTrace, mark, timed } = await import("../log");

/** Resolve after `ms` of real time, so recorded durations are genuine wall clock. */
const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("startup trace", () => {
  beforeEach(() => {
    lines.length = 0;
    beginTrace();
  });

  it("reports nothing rather than an empty table before any work runs", () => {
    // A blank table would read as "we measured and found nothing", which is a different and
    // misleading claim than "no measurement has happened yet".
    expect(formatTrace()).toBe("No startup activity recorded yet.");
  });

  it("attributes dead time between steps to the gap column", async () => {
    // The whole reason the trace exists: when every step measures fast but the session feels slow,
    // the cost is BETWEEN steps (waiting on the host, the user, or a lazy import elsewhere). A
    // report that only listed durations would show two quick steps and hide the stall entirely.
    await timed("first", async () => sleep(20));
    await sleep(60);
    await timed("second", async () => sleep(20));

    const gaps = formatTrace()
      .split("\n")
      .filter((l) => l.startsWith("first") || l.startsWith("second"))
      .map((l) => Number(/(\d+)ms\s*$/.exec(l)?.[1] ?? -1));

    // first runs immediately (no meaningful gap); second is separated by the ~60ms stall.
    expect(gaps[0]).toBeLessThan(40);
    expect(gaps[1]).toBeGreaterThan(35);
  });

  it("keeps a failed step in the trace, flagged", async () => {
    // A step that stalls and THEN throws is the most diagnostic case there is — dropping it would
    // erase exactly the evidence someone is looking for.
    await expect(
      timed("doomed", async () => {
        await sleep(10);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(formatTrace()).toContain("FAILED");
    expect(lines.some((l) => l.startsWith("error doomed"))).toBe(true);
  });

  it("orders steps by start time, not completion order", async () => {
    // Concurrent work finishes out of order. A trace sorted by completion would misrepresent which
    // step actually began first, which is what a causal reading of the timeline depends on.
    const slowFirst = timed("slow", async () => sleep(50));
    await sleep(5);
    const fastSecond = timed("fast", async () => sleep(1));
    await Promise.all([slowFirst, fastSecond]);

    const report = formatTrace();
    expect(report.indexOf("slow")).toBeLessThan(report.indexOf("fast"));
  });

  it("records marks as moments so they anchor the surrounding spans", async () => {
    await timed("before", async () => sleep(5));
    mark("sidebar opened");

    const line = formatTrace()
      .split("\n")
      .find((l) => l.startsWith("sidebar opened"));
    // Zero duration is the point: a mark says WHEN something happened, not how long it took.
    expect(line).toMatch(/\b0ms\b/);
  });

  it("attributes a blocking step to event-loop stalls, not just its own duration", async () => {
    // The distinction the whole diagnostic turns on. A span credited with seconds while the thread
    // was BLOCKED did not do seconds of work — it was queued. Reporting only the duration led to
    // exactly the wrong conclusion once already (the 21s "provision dictionary" span, whose
    // filesystem work measures ~1ms). Busy-wait, so the loop genuinely cannot run.
    await timed("blocker", async () => {
      const until = Date.now() + 600;
      while (Date.now() < until) {
        /* deliberately starve the loop */
      }
    });
    // Let the heartbeat observe the stall it just missed.
    await sleep(400);

    const report = formatTrace();
    expect(report).toContain("event-loop stalls:");
    expect(report).not.toContain("the thread stayed responsive");
  });

  it("says so plainly when the thread never stalled", async () => {
    // The negative case has to be unambiguous: absence of a stall section could otherwise read as
    // "we didn't measure", which would send someone hunting for a blocker that isn't there.
    await timed("quick", async () => sleep(5));
    expect(formatTrace()).toContain("the thread stayed responsive");
  });

  it("starts a fresh timeline when a new session begins", () => {
    // Without this, a reload would append to the previous session's spans and every "start" offset
    // would be measured from a stale origin, making the report unreadable.
    mark("stale");
    beginTrace();
    expect(formatTrace()).toBe("No startup activity recorded yet.");
  });
});
