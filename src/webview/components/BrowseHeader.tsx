import { Breadcrumb, Breadcrumbs, Link } from "react-aria-components";
import styles from "./BrowseHeader.module.css";

/** One step in the trail. The last crumb is the current page and gets no `onPress`. */
export interface Crumb {
  label: string;
  /** Omitted on the current (last) crumb, which is where you already are. */
  onPress?: () => void;
  /** Announce something other than the visible label — used by the graph-traversal home icon. */
  ariaLabel?: string;
}

/**
 * The header for DRILL-DOWN views: a breadcrumb trail, with an optional right-aligned count.
 *
 * Replaces the `← Back` bar rather than sitting under it. Two reasons, both visible:
 *
 *  * A Back arrow and a trail answer different questions. Back is "undo my last step" — right for
 *    GRAPH traversal, where you reach a word from a search, an example sentence or a cross-reference
 *    and there is no canonical parent. A trail is "where am I in a hierarchy", which is what Vocab
 *    and Kanji actually are. `DetailHeader` still serves the graph views for exactly that reason.
 *  * Stacking both cost a whole row of vertical space and made the header's HEIGHT depend on the
 *    view — the group list had a trail, the word list had a Back bar plus a title row — so moving
 *    between levels shifted everything below. One row at every level removes the shift.
 *
 * The count sits on the same row, right-aligned, because it belongs to the current crumb and a row
 * of its own would give back the space this arrangement just saved.
 */
export const BrowseHeader = ({
  crumbs,
  count
}: {
  crumbs: Crumb[];
  /** e.g. "220 words". Omitted while loading, so the row does not flicker a placeholder. */
  count?: string;
}): React.ReactElement => (
  <div className={styles.header}>
    <Breadcrumbs className={styles.crumbs}>
      {crumbs.map((crumb, i) => {
        const isCurrent = i === crumbs.length - 1;
        return (
          <Breadcrumb key={crumb.label} className={styles.crumb}>
            {/* The separator is an element, not a `::after` on the <li>: React Aria renders an
                <ol>, and the marker/first-child edge cases that come with styling one are what put
                a stray "›" before the first crumb on the earlier attempt. Rendering it only
                BETWEEN crumbs makes the rule impossible to get wrong. */}
            {i > 0 ? (
              <span className={styles.separator} aria-hidden="true">
                ›
              </span>
            ) : null}
            {isCurrent || crumb.onPress === undefined ? (
              <span className={styles.current} aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link
                className={styles.link}
                onPress={crumb.onPress}
                aria-label={crumb.ariaLabel}
              >
                {crumb.label}
              </Link>
            )}
          </Breadcrumb>
        );
      })}
    </Breadcrumbs>
    {count === undefined ? null : <span className={styles.count}>{count}</span>}
  </div>
);
