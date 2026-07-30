/**
 * Small parsers shared by the query modules.
 *
 * These read columns the data build writes — JSON arrays and concatenated code lists — and are
 * deliberately tolerant: a malformed row should degrade one field, not fail a whole lookup.
 */
/**
 * Order two JMdict nfXX frequency buckets: lower rank = more frequent = first, and unranked words
 * (null — anything outside wordfreq's top ~24,000) sort last rather than first, which is what a
 * naive numeric compare on null would do.
 */
export const byFrequency = (a: number | null, b: number | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

/** Parse a JSON-encoded string array from a DB column, tolerating malformed data. */
export const parseStrings = (json: string): string[] => {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
};

/**
 * Flatten the space-joined `group_concat` of `sense_tags.code` across a word's senses into a unique
 * set — `v5r vt n vt` → v5r, vt, n. NULL when the word has no rows of that kind.
 */
export const parseCodes = (concatenated: string | null): string[] =>
  concatenated === null
    ? []
    : [...new Set(concatenated.split(/\s+/).filter((c) => c !== ""))];

/**
 * Strip a leading honorific お/ご from a lemma, or null when there's nothing safe to strip. The
 * caller only uses this AFTER a direct resolution failed, so a lexicalized honorific (お茶, ご飯 —
 * which ARE entries) never reaches here. Guard against over-stripping: require at least two
 * characters of remainder, so お (alone) or a one-mora leftover isn't produced.
 */
export const stripHonorific = (lemma: string): string | null => {
  if (!/^[おご]/u.test(lemma)) return null;
  const rest = lemma.slice(1);
  // Length in UTF-16 units is fine: お/ご and their bases are all BMP (no surrogate pairs), and this
  // only guards against a trivially-short remainder (お alone, or a one-mora leftover).
  return rest.length >= 2 ? rest : null;
};

/** Parse a JSON-encoded number array from a DB column, tolerating malformed data. */
export const parseNumbers = (json: string): number[] => {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((v) => typeof v === "number") : [];
};

/**
 * JMdict xrefs are tuples like `["丸","まる",1]` / `["漢数字"]`, stored JSON-encoded. For M1 we
 * render just the leading surface term of each xref as a display string.
 */
export const flattenXrefs = (json: string): string[] => {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (Array.isArray(x) && typeof x[0] === "string" ? x[0] : ""))
    .filter((s) => s !== "");
};
