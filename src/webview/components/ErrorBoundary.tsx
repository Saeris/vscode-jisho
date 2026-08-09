import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { reportCrash } from "../bridge";
import { sanitizeStack } from "../../shared/diagnostics";
import styles from "./ErrorBoundary.module.css";

/**
 * Catches a render crash anywhere in the panel and offers a way out.
 *
 * A class component because React still has no hook equivalent of `getDerivedStateFromError` — this
 * is the one place in the webview that has to be one.
 *
 * WHAT IT CANNOT CATCH, so the coverage is not overestimated: errors in event handlers, in async
 * code, and anything thrown in the extension host. A rejected query or a failed `postMessage` goes
 * straight past this. It is a render boundary, not a general error handler. See
 * docs/specs/20-crash-and-issue-reporting.md.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only place this is recoverable from during development — the panel has
    // already been replaced by the fallback, so a devtools log is what a contributor reads.
    console.error("Jisho panel crashed", error, info.componentStack);
  }

  #report = (): void => {
    const { error } = this.state;
    if (!error) return;
    // Sanitized before it leaves this side. `error.stack` includes the message on line 0 in V8, so
    // the message is passed separately and the stack is scrubbed of the user's paths.
    void reportCrash(error.message, sanitizeStack(error.stack ?? ""));
  };

  #reset = (): void => {
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={styles.container} role="alert">
        <h1 className={styles.heading}>Something went wrong</h1>
        {/* Said explicitly because a crash in the panel LOOKS, to someone who just waited for a
            450 MB download, like their dictionary broke. It did not, and saying so is what stops an
            uninstall. */}
        <p className={styles.body}>
          The dictionary itself is fine. This is a display error, and nothing
          you have downloaded is affected.
        </p>
        <div className={styles.actions}>
          {/* Getting back to work is the primary action; reporting is offered, not demanded. */}
          <Button className={styles.primary} onPress={this.#reset}>
            Try again
          </Button>
          <Button className={styles.secondary} onPress={this.#report}>
            Report this problem
          </Button>
        </div>
        <p className={styles.detail}>{error.message}</p>
      </div>
    );
  }
}
