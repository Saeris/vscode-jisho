import styles from "./ComingSoon.module.css";

/**
 * A tab whose content is not built yet (#55 steps 2 and 3).
 *
 * The tab bar ships in step 1 so the navigation change can be reviewed on its own, which means Kanji
 * and Kana exist before their contents do. Saying so plainly beats an empty panel that reads as a
 * loading failure — and beats hiding the tabs, which would make the bar's shape change under the
 * user as later steps land.
 */
export const ComingSoon = ({
  title,
  detail
}: {
  title: string;
  detail: string;
}): React.ReactElement => (
  <div className={styles.container}>
    <h1 className={styles.title}>{title}</h1>
    <p className={styles.detail}>{detail}</p>
  </div>
);
