/**
 * Remember the most recent unhandled promise rejection, as context for a later crash report.
 *
 * A rejection with no query attached currently disappears with no user-visible sign at all — the
 * one genuinely silent path spec 21 found.
 *
 * It deliberately does NOT prompt. Reporting every unhandled rejection is how a reporter becomes
 * noise (an aborted request, a cancelled query, a benign race), and a reporter that cries wolf gets
 * ignored exactly when it matters. The value is narrower: when something DOES go wrong afterwards,
 * the report can say what preceded it.
 */

/** The last rejection seen, or undefined when there has not been one. */
let last: string | undefined;

/** What preceded a crash, for the report. Undefined when nothing was rejected. */
export const lastRejection = (): string | undefined => last;

/** Record one rejection. Separated from the listener so it is testable without a browser event. */
export const noteRejection = (reason: unknown): void => {
  last = reason instanceof Error ? reason.message : String(reason);
  // The console is where a contributor sees this during development. Not silenced, because a
  // rejection nobody handles is still a defect even when it is invisible to the user.
  console.error("Jisho: unhandled rejection", reason);
};

/**
 * Start listening. Called once from the webview entry.
 *
 * Thin on purpose: it only forwards to `noteRejection`, which is what the tests exercise. Driving a
 * REAL `unhandledrejection` from a test means dispatching a synthetic event, and Vitest's own
 * listener reports that as a genuine failure — so the split keeps the recorder testable without
 * filling a passing run with red that means nothing.
 *
 * Returns a teardown so a caller that installs it cannot leak into whatever runs next.
 */
export const recordRejections = (): (() => void) => {
  const onRejection = (event: PromiseRejectionEvent): void => {
    noteRejection(event.reason);
  };
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
  };
};

/** Reset between tests. Not used in production — the recorder lives as long as the webview does. */
export const clearLastRejection = (): void => {
  last = undefined;
};
