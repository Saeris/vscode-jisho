import { cva, type VariantProps } from "class-variance-authority";
import styles from "./Badge.module.css";

const badge = cva(styles.badge, {
  variants: {
    kind: {
      common: styles.common,
      pos: styles.pos,
      misc: styles.misc,
      jlpt: styles.jlpt
    }
  },
  defaultVariants: { kind: "pos" }
});

interface BadgeProps extends VariantProps<typeof badge> {
  children: React.ReactNode;
  /**
   * What the badge means, as a native `title`.
   *
   * Deliberately NOT the themed `InfoTip` the interactive pills use. `TooltipTrigger` goes through
   * React Aria's `Pressable`, which requires the trigger to carry an interactive widget role
   * (`button`, `link`, …) and rejects `note`. A badge is a LABEL — giving it `role="button"` to
   * satisfy that check would announce a button with no action to a screen reader and put ten
   * non-actions in the tab order of a word page. An unstyled tooltip is the smaller cost.
   */
  title?: string;
}

export const Badge = ({
  kind,
  children,
  title
}: BadgeProps): React.ReactElement => (
  <span className={badge({ kind })} title={title}>
    {children}
  </span>
);
