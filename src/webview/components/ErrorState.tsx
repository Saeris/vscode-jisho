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
}

export const ErrorState = ({
  error,
  context,
  fallback = "Something went wrong."
}: ErrorStateProps): React.ReactElement => {
  const message = error instanceof Error ? error.message : fallback;
  return (
    <div className={styles.container} role="alert">
      <p className={styles.message}>{message}</p>
      {/* Said here for the same reason the crash screen says it: a failure to load a word looks,
          to someone who just waited for a 450 MB download, like their dictionary is broken. */}
      <p className={styles.reassurance}>Your dictionary is not affected.</p>
      <Button
        className={styles.report}
        onPress={() => void reportCrash(`${context}: ${message}`)}
      >
        Report this problem
      </Button>
    </div>
  );
};
