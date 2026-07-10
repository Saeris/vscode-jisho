import { Button } from "react-aria-components";
import styles from "./DetailHeader.module.css";

interface DetailHeaderProps {
  onBack: () => void;
  /** When provided, a "home" control that collapses the whole navigation stack back to search. */
  onHome?: () => void;
  /** Optional trailing content (e.g. the radical picker's Clear button). */
  children?: React.ReactNode;
}

/**
 * Shared header for detail-style views: a Back control, an optional Home escape hatch (shown when
 * the user has drilled several links deep), and room for view-specific trailing actions.
 */
export const DetailHeader = ({
  onBack,
  onHome,
  children
}: DetailHeaderProps): React.ReactElement => (
  <div className={styles.header}>
    <Button className={styles.button} onPress={onBack} aria-label="Back">
      ← Back
    </Button>
    {onHome ? (
      <Button
        className={styles.button}
        onPress={onHome}
        aria-label="Back to search"
      >
        ⌂ Home
      </Button>
    ) : null}
    <span className={styles.spacer} />
    {children}
  </div>
);
