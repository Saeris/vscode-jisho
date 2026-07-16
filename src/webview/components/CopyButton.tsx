import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import styles from "./CopyButton.module.css";

interface CopyButtonProps {
  /** The text to place on the clipboard. */
  value: string;
  /** Accessible name — say what gets copied, e.g. "Copy 願". */
  label: string;
  /** Rendered as the button's content; defaults to a clipboard glyph. */
  children?: React.ReactNode;
  className?: string;
}

/** How long the copied-confirmation stays up. */
const FEEDBACK_MS = 1200;

/**
 * Copies text to the clipboard and confirms it briefly.
 *
 * The confirmation isn't decoration: a clipboard write can fail (the API needs transient user
 * activation, and the host can refuse), and a copy button that silently does nothing is worse than
 * one that admits it — so we report the outcome either way rather than assuming success.
 */
export const CopyButton = ({
  value,
  label,
  children,
  className
}: CopyButtonProps): React.ReactElement => {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  // Held in a ref so a rapid second press restarts the timer instead of leaving the first one to
  // clear the new confirmation early.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => (): void => clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), FEEDBACK_MS);
  };

  return (
    <Button
      className={[styles.copy, className].filter(Boolean).join(" ")}
      onPress={() => void copy()}
      aria-label={label}
      data-status={status}
    >
      {children ?? <span aria-hidden="true">⧉</span>}
      {/* aria-live so the outcome is announced, not just shown. */}
      <span className={styles.feedback} role="status" aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Failed" : ""}
      </span>
    </Button>
  );
};
