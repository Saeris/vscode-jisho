import { useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { aboutQuery } from "../queries";
import styles from "./About.module.css";

interface AboutProps {
  onBack: () => void;
}

/**
 * Attribution and provenance. The EDRDG license requires visible attribution for JMdict-derived
 * data, so this view is a license obligation, not decoration. Static credits are listed here;
 * dictionary provenance (revision dates, entry counts) comes live from the DB's meta table.
 */
export const About = ({ onBack }: AboutProps): React.ReactElement => {
  const { data: meta } = useQuery(aboutQuery());

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Button className={styles.back} onPress={onBack} aria-label="Back">
          ← Back
        </Button>
      </div>
      <div className={styles.body}>
        <div className={styles.section}>
          <h2>Jisho — Japanese Dictionary</h2>
          <p>
            An offline Japanese dictionary for VSCode, inspired by{" "}
            <a href="https://ricoapps.com/">Shirabe Jisho</a>.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Dictionary data</h2>
          <p>
            This extension uses the{" "}
            <a href="http://www.edrdg.org/jmdict/j_jmdict.html">JMdict</a>{" "}
            dictionary files, which are the property of the{" "}
            <a href="https://www.edrdg.org/">
              Electronic Dictionary Research and Development Group
            </a>
            , and are used in conformance with the Group&apos;s{" "}
            <a href="https://www.edrdg.org/edrdg/licence.html">licence</a>. Data
            is sourced via{" "}
            <a href="https://github.com/scriptin/jmdict-simplified">
              jmdict-simplified
            </a>
            .
          </p>
          {meta ? (
            <table className={styles.metaTable}>
              <tbody>
                <tr>
                  <td>Variant</td>
                  <td>{meta["variant"] ?? "unknown"}</td>
                </tr>
                <tr>
                  <td>Entries</td>
                  <td>{meta["wordCount"] ?? "unknown"}</td>
                </tr>
                <tr>
                  <td>JMdict date</td>
                  <td>{meta["dictDate"] ?? "unknown"}</td>
                </tr>
                <tr>
                  <td>Built</td>
                  <td>{meta["builtAt"] ?? "unknown"}</td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </div>

        <div className={styles.section}>
          <h2>Other credits</h2>
          <p>
            Romaji transliteration by{" "}
            <a href="https://github.com/WaniKani/WanaKana">WanaKana</a> (MIT).
          </p>
        </div>
      </div>
    </div>
  );
};
