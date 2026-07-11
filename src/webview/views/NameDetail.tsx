import { useQuery } from "@tanstack/react-query";
import type { NameDetailDto } from "../../shared/messages";
import { nameQuery } from "../queries";
import { Badge } from "../components/Badge";
import { DetailHeader } from "../components/DetailHeader";
import styles from "./NameDetail.module.css";

interface NameDetailProps {
  id: string;
  onBack: () => void;
  onHome?: () => void;
}

/**
 * A simplified word-detail variant for a JMnedict name: writing(s), reading(s), and each
 * translation with its name-type badges (surname/place/given/company…). No senses, POS, or pitch.
 */
export const NameDetail = ({
  id,
  onBack,
  onHome
}: NameDetailProps): React.ReactElement => {
  const { data, isPending, isError, error } = useQuery(nameQuery(id));

  return (
    <div className={styles.container}>
      <DetailHeader onBack={onBack} onHome={onHome} />
      <div className={styles.body}>
        {isPending ? (
          <p>Loading…</p>
        ) : isError ? (
          <p>{error instanceof Error ? error.message : "Failed to load."}</p>
        ) : data === null ? (
          <p>Name not found.</p>
        ) : (
          <NameBody name={data} />
        )}
      </div>
    </div>
  );
};

const NameBody = ({ name }: { name: NameDetailDto }): React.ReactElement => {
  // Index access is typed non-undefined (noUncheckedIndexedAccess off), so guard on length to get
  // a genuine fallback when a name has no kanji writing.
  const hasKanji = name.kanji.length > 0;
  const headword = hasKanji
    ? name.kanji[0]
    : name.kana.length > 0
      ? name.kana[0]
      : "";
  return (
    <>
      <div className={styles.writing}>
        <span className={styles.headword} lang="ja">
          {headword}
        </span>
        {hasKanji && name.kana.length > 0 ? (
          <div className={styles.readings} lang="ja">
            {name.kana.join("、")}
          </div>
        ) : null}
      </div>

      <ol className={styles.translations}>
        {name.translations.map((t, i) => (
          <li key={i} className={styles.translation}>
            <div className={styles.types}>
              {t.types.map((type) => (
                <Badge key={type.code} kind="misc" title={type.description}>
                  {type.description}
                </Badge>
              ))}
            </div>
            <div className={styles.translationText}>
              {t.translations.join("; ")}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
};
