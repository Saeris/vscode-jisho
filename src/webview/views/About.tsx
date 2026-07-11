import { useQuery } from "@tanstack/react-query";
import { aboutQuery } from "../queries";
import { DetailHeader } from "../components/DetailHeader";
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
      <DetailHeader onBack={onBack} />
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
          <p>
            Kanji data comes from{" "}
            <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project">
              KANJIDIC2
            </a>{" "}
            (© EDRDG,{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/">
              CC BY-SA 4.0
            </a>
            ) and radical breakdowns from{" "}
            <a href="https://www.edrdg.org/krad/kradinf.html">
              KRADFILE / RADKFILE
            </a>{" "}
            (© EDRDG; RADKFILE2/KRADFILE2 © Jim Rose).
          </p>
          <p>
            Word-level JLPT tags come from{" "}
            <a href="https://www.tanos.co.uk/jlpt/">
              Jonathan Waller&apos;s JLPT Resources
            </a>{" "}
            (
            <a href="https://creativecommons.org/licenses/by-sa/4.0/">
              CC BY-SA 4.0
            </a>
            ), via{" "}
            <a href="https://github.com/stephenmk/yomitan-jlpt-vocab">
              yomitan-jlpt-vocab
            </a>
            . No official JLPT vocabulary list exists, so these levels are an
            unofficial community estimate.
          </p>
          <p>
            Pitch accent data (mora notation) comes from{" "}
            <a href="https://github.com/mifunetoshiro/kanjium">Kanjium</a> by
            Uros O. (derived from NHK/Wadoku work),{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/">
              CC BY-SA 4.0
            </a>
            .
          </p>
          <p>
            Example sentences come from the Tanaka corpus, maintained by the{" "}
            <a href="https://tatoeba.org/">Tatoeba</a> project (
            <a href="https://creativecommons.org/licenses/by/2.0/fr/deed.en">
              CC BY 2.0 FR
            </a>
            ), embedded in JMdict via jmdict-simplified.
          </p>
          <p>
            The names dictionary (optional download) uses{" "}
            <a href="https://www.edrdg.org/enamdict/enamdict_doc.html">
              JMnedict
            </a>
            , © EDRDG, used under the{" "}
            <a href="https://www.edrdg.org/edrdg/licence.html">EDRDG licence</a>
            .
          </p>
          <p>
            Stroke-order animations are derived from{" "}
            <a href="https://github.com/parsimonhi/animCJK">AnimCJK</a> (©
            FM&amp;SH), whose kanji glyph paths adapt the Arphic PL KaitiM fonts
            and Makemeahanzi under the{" "}
            <a href="https://ftp.gnu.org/non-gnu/chinese-fonts-truetype/LICENSE">
              Arphic Public License
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
                  <td>Words</td>
                  <td>{meta["wordCount"] ?? "unknown"}</td>
                </tr>
                <tr>
                  <td>Kanji</td>
                  <td>{meta["kanjiCount"] ?? "unknown"}</td>
                </tr>
                <tr>
                  <td>JMdict date</td>
                  <td>{meta["dictDate"] ?? "unknown"}</td>
                </tr>
                <tr>
                  <td>Kanjidic date</td>
                  <td>{meta["kanjidicDate"] ?? "unknown"}</td>
                </tr>
                {meta["jlptMatched"] ? (
                  <tr>
                    <td>JLPT-tagged words</td>
                    <td>{meta["jlptMatched"]}</td>
                  </tr>
                ) : null}
                {meta["pitchRows"] ? (
                  <tr>
                    <td>Pitch-tagged readings</td>
                    <td>{meta["pitchRows"]}</td>
                  </tr>
                ) : null}
                {meta["sentenceRows"] ? (
                  <tr>
                    <td>Example sentences</td>
                    <td>{meta["sentenceRows"]}</td>
                  </tr>
                ) : null}
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
          <p>
            The <strong>WK</strong> links on word and kanji pages open a search
            on <a href="https://www.wanikani.com/">WaniKani</a>, a
            kanji-learning service by Tofugu. No WaniKani content is bundled;
            the links are a convenience only.
          </p>
        </div>
      </div>
    </div>
  );
};
