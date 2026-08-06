import type { ComponentProps } from "react";
import { Focusable, Tooltip, TooltipTrigger } from "react-aria-components";
import styles from "./InfoTip.module.css";

interface InfoTipProps {
  /** The tooltip body. A string for the common case; nodes when it needs structure. */
  content: React.ReactNode;
  /**
   * The element the tooltip describes. Rendered as-is — the trigger differs everywhere this is
   * used (an inert `<span>` pill, a `<button>` pill, a `<Badge>`, an `<a>`), so wrapping it in a
   * fixed element would fight every caller. It MUST be a single element that forwards its ref and
   * spreads props onto a DOM node, and it must carry a role or be semantic HTML, or a screen
   * reader has nothing to attach the description to.
   */
  children: ComponentProps<typeof Focusable>["children"];
  /** Hover warmup, ms. Focus always shows instantly regardless. */
  delay?: number;
}

/**
 * A themed hover/focus tooltip, replacing the browser's `title=` attribute.
 *
 * `title` was doing this job in ten places and does it badly: the delay is ~1s and unconfigurable,
 * the presentation is the OS's rather than the editor's (so it ignores the VS Code theme entirely),
 * it never appears on keyboard focus, and it cannot hold anything but a plain string. React Aria's
 * tooltip fixes all four, and gives us the shared warmup behaviour — once one tooltip has opened,
 * neighbouring ones open immediately, which is what makes a row of tag pills feel like one control
 * rather than ten separate waits.
 *
 * `Focusable` is what lets a non-button trigger participate: it makes the child focusable and wires
 * the ARIA description onto it. Interactive triggers (a real `<button>`) work through it too, so
 * callers do not have to pick a variant.
 */
export const InfoTip = ({
  content,
  children,
  delay = 300
}: InfoTipProps): React.ReactElement => (
  <TooltipTrigger delay={delay}>
    <Focusable>{children}</Focusable>
    <Tooltip className={styles.tooltip} offset={4}>
      {content}
    </Tooltip>
  </TooltipTrigger>
);
