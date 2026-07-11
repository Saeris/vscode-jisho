import styles from "./WaniKaniLink.module.css";

/**
 * An outbound "WK" link to look a term up on WaniKani. We don't ingest WaniKani content (its
 * license forbids redistribution and it needs an API key), so this is a citation only. We link the
 * `/search?query=` endpoint rather than a direct `/vocabulary/` or `/kanji/` URL because WaniKani
 * covers only a small curated subset of JMdict — a direct URL would 404 for most words, whereas
 * search degrades gracefully to "Nothing was found" for terms outside its curriculum. The anchor
 * opens externally (VSCode intercepts webview links and hands them to the OS browser).
 */
export const WaniKaniLink = ({
  term
}: {
  term: string;
}): React.ReactElement => (
  <a
    className={styles.link}
    href={`https://www.wanikani.com/search?query=${encodeURIComponent(term)}`}
    title={`Look up ${term} on WaniKani`}
  >
    WK
  </a>
);
