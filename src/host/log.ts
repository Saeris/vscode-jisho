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

export const beginTrace = (): void => {
  origin = Date.now();
  spans.length = 0;
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
  return lines.join("\n");
};
