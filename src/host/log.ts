/**
 * Diagnostic log channel ("Jisho") and an in-memory startup trace.
 *
 * Startup cost is otherwise invisible: the extension does its expensive work lazily (opening a
 * 51MB database, provisioning a 409MB names database, initialising a 12MB tokenizer WASM), and
 * when a first search feels slow there is no way to tell WHICH of those it was waiting on. Every
 * lazy initialisation reports how long it took, so a slow start can be read rather than guessed.
 *
 * Durations alone turned out not to be enough. A slow *session* is a question about wall-clock
 * SHAPE — what ran, in what order, and where the gaps were — and individually-fast steps can still
 * add up to a slow first result, or be separated by dead time that no single measurement shows. So
 * every step is also recorded as a span relative to activation, dumpable as one report via the
 * "Jisho: Show Startup Trace" command.
 *
 * Uses a LogOutputChannel: VS Code renders levels and timestamps, and users can raise the level
 * without a setting of ours.
 */
import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

export const log = (): vscode.LogOutputChannel => {
  channel ??= vscode.window.createOutputChannel("Jisho", { log: true });
  return channel;
};

/** One recorded step: when it started and how long it took, both relative to activation. */
interface Span {
  label: string;
  /** ms after activation that this step began. */
  at: number;
  /** How long the step took, in ms. */
  ms: number;
  ok: boolean;
}

/**
 * Activation timestamp — the zero point every span is measured from. Set by `beginTrace()`; until
 * then spans are measured from module load, which is close enough that a missing call cannot make
 * the numbers lie by much.
 */
let origin = Date.now();
const spans: Span[] = [];
/** Bounded so a long-lived session can't grow this without limit. */
const MAX_SPANS = 500;

/**
 * Event-loop lag samples: how late a timer scheduled for `LAG_INTERVAL` actually fired.
 *
 * This is the difference between "our code is slow" and "our code is QUEUED". The extension host
 * runs one JS thread, so an `await` that resolves in microseconds can still be credited with
 * seconds of wall clock if something else monopolises the thread in between — and a span's duration
 * cannot tell those apart. A heartbeat can: if lag spikes to 20s, nothing on this thread ran for
 * 20s, whoever was to blame.
 */
interface LagSample {
  /** ms after activation that the stall was observed. */
  at: number;
  /** How much later than scheduled the heartbeat fired. */
  lag: number;
}

const LAG_INTERVAL = 250;
/** Below this, lag is ordinary scheduling jitter and not worth recording. */
const LAG_FLOOR = 100;
const MAX_LAG_SAMPLES = 200;
const lagSamples: LagSample[] = [];
let heartbeat: ReturnType<typeof setInterval> | undefined;

const startHeartbeat = (): void => {
  let previous = Date.now();
  heartbeat = setInterval(() => {
    const now = Date.now();
    const lag = now - previous - LAG_INTERVAL;
    previous = now;
    if (lag >= LAG_FLOOR && lagSamples.length < MAX_LAG_SAMPLES) {
      lagSamples.push({ at: now - origin, lag });
    }
  }, LAG_INTERVAL);
  // Never keep the host alive for diagnostics.
  heartbeat.unref();
};

/** Stop the heartbeat (extension deactivation). */
export const endTrace = (): void => {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = undefined;
};

export const beginTrace = (): void => {
  origin = Date.now();
  spans.length = 0;
  lagSamples.length = 0;
  endTrace();
  startHeartbeat();
};

const record = (label: string, at: number, ms: number, ok: boolean): void => {
  if (spans.length >= MAX_SPANS) return;
  spans.push({ label, at, ms, ok });
};

/**
 * Time an async step, log its duration, and record it in the trace. Returns the step's value, so it
 * wraps a call in place: `const db = await timed("open dictionary", () => Dictionary.open(path))`.
 */
export const timed = async <T>(
  label: string,
  work: () => Promise<T>
): Promise<T> => {
  const started = Date.now();
  try {
    const result = await work();
    const elapsed = Date.now() - started;
    record(label, started - origin, elapsed, true);
    log().info(`${label}: ${elapsed}ms`);
    return result;
  } catch (err) {
    // Failures are the most interesting timings — a slow path that then throws is exactly the
    // case worth seeing.
    const elapsed = Date.now() - started;
    record(label, started - origin, elapsed, false);
    log().error(`${label}: failed after ${elapsed}ms — ${String(err)}`);
    throw err;
  }
};

/** Record a zero-duration event (a moment, not a span) — e.g. "first search request received". */
export const mark = (label: string): void => {
  const at = Date.now() - origin;
  record(label, at, 0, true);
  log().info(`${label} @ ${at}ms`);
};

/**
 * Render the trace as a report.
 *
 * The gap column is the point of this: it shows dead time BETWEEN steps, which is where a slow
 * session hides when every individual step measures fast. A large gap before the first search means
 * the extension was waiting on the user or the host, not on our code — the difference between "we
 * are slow" and "startup is slow", which is not otherwise distinguishable from the log.
 */
export const formatTrace = (): string => {
  if (spans.length === 0) return "No startup activity recorded yet.";
  const rows = [...spans].sort((a, b) => a.at - b.at);
  const width = Math.max(...rows.map((r) => r.label.length));
  const lines = [
    `Jisho startup trace — ${rows.length} step(s), t=0 at activation`,
    "",
    `${"step".padEnd(width)}   start      dur      gap`,
    `${"-".repeat(width)}   -----      ---      ---`
  ];
  let previousEnd = 0;
  for (const row of rows) {
    const gap = row.at - previousEnd;
    lines.push(
      `${row.label.padEnd(width)}   ${`${row.at}ms`.padStart(7)}  ${`${row.ms}ms`.padStart(7)}  ${`${gap > 0 ? gap : 0}ms`.padStart(7)}${row.ok ? "" : "  FAILED"}`
    );
    previousEnd = Math.max(previousEnd, row.at + row.ms);
  }
  lines.push(
    "",
    `total span: ${previousEnd}ms of wall clock from activation to last step end`
  );

  // Event-loop lag is what makes the durations above interpretable. A step credited with 20s while
  // the loop was blocked for 19s of it did not do 20s of work — it sat in the queue. Without this,
  // the two are indistinguishable and the blame lands on whatever span happened to be open.
  if (lagSamples.length > 0) {
    const total = lagSamples.reduce((sum, s) => sum + s.lag, 0);
    const worst = [...lagSamples].sort((a, b) => b.lag - a.lag).slice(0, 10);
    lines.push(
      "",
      `event-loop stalls: ${lagSamples.length} over ${LAG_FLOOR}ms, ${total}ms blocked in total`,
      "(the JS thread ran NOTHING during these — our spans and VS Code's own work alike)",
      "",
      "        at      blocked",
      "  --------      -------"
    );
    for (const sample of worst) {
      lines.push(
        `  ${`${sample.at}ms`.padStart(8)}      ${`${sample.lag}ms`.padStart(7)}`
      );
    }
    lines.push(
      "",
      `blocked time is ${Math.round((total / Math.max(previousEnd, 1)) * 100)}% of the traced window`
    );
  } else {
    lines.push(
      "",
      `event-loop stalls: none over ${LAG_FLOOR}ms — the thread stayed responsive, so the`,
      "durations above are real work rather than queueing"
    );
  }
  return lines.join("\n");
};
