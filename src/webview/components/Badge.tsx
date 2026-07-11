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
