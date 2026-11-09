import { Button } from "react-aria-components";
import { reportCrash } from "../bridge";
import styles from "./ErrorState.module.css";

/**
 * A failed request, with somewhere to go.
 *
 * Every detail view and the search list already RENDERED their error — as a bare paragraph with the
 * message in it. The gap spec 21 closes is that reading one was a dead end: "Dictionary schema
 * version 5 does not match the required 6" with nothing to click is arguably worse than a crash,
 * which at least offers a report button.
 *
 * No stack is sent. A query rejection's stack describes the bridge's own plumbing rather than the
 * cause, so it would be noise in the issue — the message plus the diagnostics is what identifies
 * these.
 */
interface ErrorStateProps {
  /** The failure, as thrown. Non-Error values are stringified by the caller's fallback. */
  error: unknown;
  /** What was being attempted, for the issue title: "loading 食べる", "searching". */
  context: string;
  /** Shown when the error carries no message of its own. */
  fallback?: string;
  /**
   * Run the failed request again. Offered first when present, because it is what fixes most of these.
   *
   * Queries never retry on their own here (`retry: false`, `staleTime: Infinity`), so without this a
   * failure stayed on screen until the query changed: someone offline during the first download, or
   * caught by a dictionary update, had to edit their search to try again — and the only thing on
   * offer was to report a problem that a retry would have fixed (audit SM-9).
   */
  onRetry?: () => void;
}

export const ErrorState = ({
  error,
  context,
  fallback = "Something went wrong.",
  onRetry
}: ErrorStateProps): React.ReactElement => {
  const message = error instanceof Error ? error.message : fallback;
  return (
    <div className={styles.container} role="alert">
      <p className={styles.message}>{message}</p>
      {/* Said here for the same reason the crash screen says it: a failure to load a word looks,
          to someone who just waited for a 450 MB download, like their dictionary is broken. */}
      <p className={styles.reassurance}>Your dictionary is not affected.</p>
      <div className={styles.actions}>
        {onRetry ? (
          <Button className={styles.retry} onPress={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button
          className={styles.report}
          onPress={() => void reportCrash(`${context}: ${message}`)}
        >
          Report this problem
        </Button>
      </div>
    </div>
  );
};
