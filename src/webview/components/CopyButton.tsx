import { Button } from "react-aria-components";
import { useCopyStatus } from "./useCopyStatus";
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

/**
 * Copies text to the clipboard and confirms it briefly. The write and its transient status live in
 * `useCopyStatus`, shared with the copy-as menu.
 */
export const CopyButton = ({
  value,
  label,
  children,
  className
}: CopyButtonProps): React.ReactElement => {
  const { status, copy } = useCopyStatus();

  return (
    <Button
      className={[styles.copy, className].filter(Boolean).join(" ")}
      onPress={() => void copy(value)}
      aria-label={label}
      data-status={status}
      // Exposed so a test can assert WHAT would be copied: the clipboard is not readable from the
      // workbench context, and the value is not otherwise present in the DOM.
      data-value={value}
    >
      {children ?? <span aria-hidden="true">⧉</span>}
      {/* aria-live so the outcome is announced, not just shown. */}
      <span className={styles.feedback} role="status" aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Failed" : ""}
      </span>
    </Button>
  );
};
