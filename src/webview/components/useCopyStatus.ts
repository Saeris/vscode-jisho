import { useEffect, useRef, useState } from "react";
import { copyText } from "../bridge";

/** How long the copied-confirmation stays up. */
const FEEDBACK_MS = 1200;

export type CopyStatus = "idle" | "copied" | "failed";

/**
 * Clipboard writes with a transient outcome, shared by every copy affordance.
 *
 * The write goes through the HOST rather than `navigator.clipboard`: a webview's clipboard needs
 * transient user activation and can be refused outright, while the extension host's API has
 * neither constraint. The outcome is reported either way — a copy control that silently does
 * nothing is worse than one that admits it failed.
 */
export const useCopyStatus = (): {
  status: CopyStatus;
  copy: (value: string) => Promise<void>;
} => {
  const [status, setStatus] = useState<CopyStatus>("idle");
  // Held in a ref so a rapid second press restarts the timer instead of leaving the first one to
  // clear the new confirmation early.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => (): void => clearTimeout(timer.current), []);

  const copy = async (value: string): Promise<void> => {
    try {
      await copyText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), FEEDBACK_MS);
  };

  return { status, copy };
};
