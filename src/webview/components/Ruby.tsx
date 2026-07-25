import styles from "./Ruby.module.css";

/**
 * Render mirrordown ruby markup (`{本|ほん} を`) as real `<ruby>` furigana — ほん sits over 本.
 *
 * The sidebar can do what the editor hover cannot: VS Code strips `style` from hover HTML and pins
 * `<rt>` at 7px, so hovers fall back to a separate reading line — but here we own the stylesheet, so
 * the reading sits over its own kanji at a size a learner can read (see Ruby.module.css). Shared by
 * the grammar-note tooltip (Term) and the more-examples page (F1), which store build-time furigana.
 */
export const Ruby = ({ markup }: { markup: string }): React.ReactElement => (
  <span className={styles.ruby}>
    {markup.split(/(\{[^|{}]+\|[^{}]+\})/gu).map((chunk, index) => {
      const group = /^\{([^|{}]+)\|([^{}]+)\}$/u.exec(chunk);
      if (!group) return chunk;
      return (
        // eslint-disable-next-line react/no-array-index-key -- chunks are positional, not identities
        <ruby key={index}>
          {group[1]}
          <rt>{group[2]}</rt>
        </ruby>
      );
    })}
  </span>
);
