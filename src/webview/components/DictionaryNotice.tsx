import { Button, ProgressBar } from "react-aria-components";
import { dictionaryAction, reportCrash } from "../bridge";
import { useDictionaryStatus } from "../useDictionaryStatus";
import styles from "./DictionaryNotice.module.css";

/**
 * Where the word dictionary is, when that is not simply "ready" — with the recovery each state needs.
 *
 * The panel used to know nothing of this. On first run it showed "Searching…" for the whole 119 MB
 * download, and every failure looked like a bug to report: a user who was offline, or whose
 * dictionary needed updating, was asked to file an issue (audit SM-10, I-2). Each failure now says
 * what happened and offers the one action that fixes it.
 *
 * Renders nothing while the dictionary is ready, or not yet asked for.
 */
export const DictionaryNotice = (): React.ReactElement | null => {
  const { words } = useDictionaryStatus();

  switch (words.state) {
    case "downloading":
      return (
        <div className={styles.notice} role="status">
          <ProgressBar
            className={styles.progress}
            value={words.percent}
            aria-label="Dictionary download"
          >
            {({ percentage = 0 }) => (
              <>
                <p className={styles.title}>
                  Downloading the dictionary — {Math.round(percentage)}%
                </p>
                <div className={styles.track}>
                  <div
                    className={styles.fill}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </>
            )}
          </ProgressBar>
          <p className={styles.detail}>
            This happens once. After it, everything works offline.
          </p>
        </div>
      );
    case "opening":
      return (
        <p className={styles.notice} role="status">
          Opening the dictionary…
        </p>
      );
    case "ready":
      // An update downloads behind a dictionary that keeps working, so this is a footnote, not a
      // blocker — and VS Code's own notification shows it too.
      return words.updating === undefined ? null : (
        <p className={styles.detail} role="status">
          Updating the dictionary — {words.updating}%. You can keep searching.
        </p>
      );
    case "failed":
      return <FailureNotice reason={words.reason} message={words.message} />;
    case "absent":
    case "swapping":
      return null;
  }
};

const FailureNotice = ({
  reason,
  message
}: {
  reason: "offline" | "schema-older" | "schema-newer" | "io";
  message: string;
}): React.ReactElement => {
  switch (reason) {
    case "offline":
      return (
        <div className={styles.notice} role="alert">
          <p className={styles.title}>Couldn’t download the dictionary.</p>
          <p className={styles.detail}>
            Check your connection, then try again.
          </p>
          <Button
            className={styles.primary}
            onPress={() => void dictionaryAction("retry")}
          >
            Try again
          </Button>
        </div>
      );
    case "schema-older":
      return (
        <div className={styles.notice} role="alert">
          <p className={styles.title}>
            Your dictionary is older than this version of Jisho needs.
          </p>
          <Button
            className={styles.primary}
            onPress={() => void dictionaryAction("update")}
          >
            Update the dictionary
          </Button>
        </div>
      );
    case "schema-newer":
      return (
        <div className={styles.notice} role="alert">
          <p className={styles.title}>
            Your dictionary needs a newer version of Jisho.
          </p>
          <p className={styles.detail}>Update Jisho, then reload the window.</p>
          <Button
            className={styles.primary}
            onPress={() => void dictionaryAction("updateJisho")}
          >
            Update Jisho
          </Button>
        </div>
      );
    case "io":
      return (
        <div className={styles.notice} role="alert">
          <p className={styles.title}>Jisho couldn’t open its dictionary.</p>
          <p className={styles.detail}>{message}</p>
          <div className={styles.actions}>
            <Button
              className={styles.primary}
              onPress={() => void dictionaryAction("retry")}
            >
              Try again
            </Button>
            <Button
              className={styles.link}
              onPress={() =>
                void reportCrash(`Opening the dictionary: ${message}`)
              }
            >
              Report this problem
            </Button>
          </div>
        </div>
      );
  }
};
