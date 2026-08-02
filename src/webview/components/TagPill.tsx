import type { TagDto } from "../../shared/messages";
import { posCategory, posLabel, usageLabel } from "../../shared/posTags";
import styles from "./TagPill.module.css";

/**
 * A compact grammar/usage chip (BACKLOG #50).
 *
 * The page used to spell every tag out in full, so それぞれ read as "adverb (fukushi), noun
 * (common) (futsuumeishi), nouns which may take the genitive case particle 'no', word usually
 * written using kana alone" — a paragraph of metadata above a one-line definition. The hover had
 * already solved this with compact pills; this brings the page in line, sharing the vocabulary in
 * `shared/posTags` so the two surfaces can never drift.
 *
 * PARTS OF SPEECH carry their palette hue — the same colour that word wears in the breakdown bar
 * and in the editor, so "this is a verb" is said the same way everywhere. USAGE, FIELD and DIALECT
 * tags stay neutral: they are not parts of speech, and a hue would imply a grammatical meaning they
 * do not have.
 *
 * The full JMdict description is always the `title`, so shortening a label never loses information.
 */
export const TagPill = ({
  tag,
  kind
}: {
  tag: TagDto;
  /** `pos` pills are coloured by the palette; everything else is neutral. */
  kind: "pos" | "usage";
}): React.ReactElement => {
  const category = kind === "pos" ? posCategory(tag.code) : undefined;
  const label =
    kind === "pos"
      ? (posLabel(tag.code) ?? tag.description)
      : usageLabel(tag.code, tag.description);
  return (
    <span
      className={styles.pill}
      // Drives the palette colour in CSS; absent for usage tags and for POS codes outside the
      // nine categories, which then render neutral.
      data-pos={category}
      title={tag.description}
      // The label is often Japanese (名詞, 尊敬語) while the tooltip is English; marking the pill
      // itself avoids a screen reader reading the kanji as if it were prose.
      lang={/[぀-ヿ㐀-鿿]/u.test(label) ? "ja" : undefined}
    >
      {label}
    </span>
  );
};

/** The pill row above a run of senses: parts of speech first, then usage/field/dialect. */
export const TagPills = ({
  pos,
  usage
}: {
  pos: TagDto[];
  usage: TagDto[];
}): React.ReactElement | null => {
  if (pos.length === 0 && usage.length === 0) return null;
  return (
    <p className={styles.row}>
      {pos.map((t) => (
        <TagPill key={`p-${t.code}`} tag={t} kind="pos" />
      ))}
      {usage.map((t) => (
        <TagPill key={`u-${t.code}`} tag={t} kind="usage" />
      ))}
    </p>
  );
};
