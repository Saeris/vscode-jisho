import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import type { ComponentTreeDto } from "../../shared/messages";
import { componentTreeQuery } from "../queries";
import { DetailHeader } from "../components/DetailHeader";
import styles from "./ComponentTree.module.css";

interface ComponentTreeProps {
  literal: string;
  onBack: () => void;
  onHome?: () => void;
  /** Tap a node to open that character's detail. */
  onOpenKanji: (literal: string) => void;
}

/**
 * The recursive component breakdown (cjk-decomp): 願 → 原 + 頁 → 貝 → 目 + 八, each node annotated
 * with meaning/readings, indented to show the hierarchy — the Jisho-style tree from the reference.
 *
 * Its own pushed sub-page rather than inline on the kanji detail: this extension leads with meaning
 * and readings for translation/authoring, and the tree (10+ nodes for a character like 願) is a
 * study destination you opt into. Falls back to nothing here — the caller only opens this view when
 * a tree exists; the flat Parts list on the kanji detail covers characters without one.
 */
export const ComponentTree = ({
  literal,
  onBack,
  onHome,
  onOpenKanji
}: ComponentTreeProps): React.ReactElement => {
  const { data, isPending, isError } = useQuery(componentTreeQuery(literal));

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack} onHome={onHome} />
      <div className={styles.body}>
        <h1 className={styles.title}>
          <span lang="ja">{literal}</span> component tree
        </h1>
        {isPending ? (
          <p className={styles.status}>Loading…</p>
        ) : isError || data === null ? (
          <p className={styles.status}>
            No component breakdown for this kanji.
          </p>
        ) : (
          // The root itself is the kanji we're on, so render its children as the top level.
          <ul className={styles.tree}>
            {data.children.map((child, i) => (
              <TreeNode
                key={`${child.literal}-${i}`}
                node={child}
                onOpenKanji={onOpenKanji}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const TreeNode = ({
  node,
  onOpenKanji
}: {
  node: ComponentTreeDto;
  onOpenKanji: (literal: string) => void;
}): React.ReactElement => (
  <li className={styles.node}>
    <Button
      className={styles.row}
      onPress={() => onOpenKanji(node.literal)}
      aria-label={`Open ${node.literal}`}
    >
      <span className={styles.glyph} lang="ja">
        {node.literal}
      </span>
      <span className={styles.meta}>
        {node.meaningPreview ? (
          <span className={styles.meaning}>{node.meaningPreview}</span>
        ) : null}
        {node.readingPreview ? (
          <span className={styles.reading} lang="ja">
            {node.readingPreview}
          </span>
        ) : null}
      </span>
    </Button>
    {node.children.length > 0 ? (
      <ul className={styles.tree}>
        {node.children.map((child, i) => (
          <TreeNode
            key={`${child.literal}-${i}`}
            node={child}
            onOpenKanji={onOpenKanji}
          />
        ))}
      </ul>
    ) : null}
  </li>
);
