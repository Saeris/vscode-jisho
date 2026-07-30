/**
 * Script tests, shared by the host and the webview.
 *
 * These were six copies of two regexes that looked like one inconsistency. They are not: the callers
 * ask three genuinely different questions, and the answers correctly differ on the iteration marks
 * (々 〆) and the CJK compatibility block. Naming them separately is the point of this module —
 * previously the distinction existed only as a subtly different character class in each file.
 */

/** CJK ideographs plus the compatibility block. Neither iteration marks nor kana. */
const KANJI_CLASS = /[㐀-鿿豈-﫿]/u;

/**
 * Does this text contain at least one kanji?
 *
 * The tokenizer gate. IPADIC's lattice relies on kanji↔kana script transitions to find word
 * boundaries, so all-kana input (にほんごをはなしますか) has no boundary signal and segments into
 * garbage — features check this and fall back rather than acting on bad segmentation.
 *
 * Iteration marks are deliberately excluded: 々 cannot supply the script transition on its own.
 */
export const hasKanji = (text: string): boolean => KANJI_CLASS.test(text);

/**
 * Is this single character a kanji that could have its own dictionary entry?
 *
 * Used where a character becomes a LOOKUP — the distinct characters of a query in `searchKanji`, and
 * the per-character buttons in a word's headword. Iteration marks are excluded on purpose: 々 has no
 * `kanji_characters` row, so treating it as tappable would give a "kanji not found" dead end, the
 * same failure BACKLOG's kanji-parts fix removed for stroke shapes.
 */
export const isKanjiChar = (character: string): boolean =>
  KANJI_CLASS.test(character);

/**
 * Is this character kanji FOR THE PURPOSE OF READING ALIGNMENT?
 *
 * Includes the iteration marks 々 and 〆, which is the one place they belong: 々 repeats the
 * preceding kanji and therefore carries a reading (人々 → ひとびと), so furigana alignment has to
 * treat it as part of a kanji run or the reading splits in the wrong place. Excluding it here would
 * annotate 人 and leave 々 bare.
 */
export const isKanjiForReading = (character: string): boolean =>
  /[㐀-鿿豈-﫿々〆]/u.test(character);
