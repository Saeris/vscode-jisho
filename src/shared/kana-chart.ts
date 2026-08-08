/**
 * The gojūon chart, as a GRID — the Kana tab (#55 step 3).
 *
 * `GOJUON_ROWS` in ./kana already lists the 46 base kana, but as a FLAT list in syllabary order: it
 * exists to label a jump rail, where the only thing that matters is which heading comes next. A
 * chart is a different object. It is two-dimensional, the vowel columns have to line up down the
 * page, and it covers the 58 kana the rail has no reason to know about (the voiced rows and the
 * digraphs). Deriving one from the other would mean encoding the chart's gaps as rules; they are
 * data, so they are written as data.
 *
 * Written once in hiragana. Katakana is derived by codepoint (see `toKatakana`) rather than typed
 * out a second time — 104 hand-entered characters is 104 chances to transpose one, and the two
 * scripts genuinely are a fixed offset apart in Unicode. That relation is not an assumption: it is
 * the same one `kana.ts` already depends on in the opposite direction, and it is asserted over every
 * cell of this table in the spec.
 */

/** A single cell: the kana and how it is read. `undefined` marks a gap in the chart. */
export interface KanaCell {
  kana: string;
  romaji: string;
  /**
   * Obsolete in modern Japanese — ゐ/ゑ and their katakana twins, dropped by the 1946 orthography
   * reform and now seen only in historical text and a few proper nouns (ヱビス).
   *
   * Shown rather than omitted, because a learner meeting one in the wild needs somewhere to look it
   * up, and a chart that silently lacks a row a paper chart has looks broken. Dimmed so it reads as
   * "this exists but you will not use it".
   *
   * Deliberately NOT set on ぢ/づ. They are rare, and Shirabe dims them, but they are entirely
   * current — つづく and はなぢ are ordinary spellings — so dimming them would teach the wrong
   * thing. Rarity and obsolescence are different claims and only the second one is made here.
   */
  obsolete?: true;
}

export interface KanaRow {
  /** Five columns, a/i/u/e/o. A hole in the row is a hole in the chart, never a shifted cell. */
  cells: Array<KanaCell | undefined>;
}

export interface KanaSection {
  id: string;
  label: string;
  /** The romaji column headings, which differ between the base chart and the digraphs. */
  columns: readonly string[];
  rows: readonly KanaRow[];
}

/** A cell literal: `[kana, romaji]`, or `[kana, romaji, "obsolete"]`. */
type CellSpec = [string, string] | [string, string, "obsolete"];

const row = (...cells: Array<CellSpec | undefined>): KanaRow => ({
  cells: cells.map((c) =>
    c === undefined
      ? undefined
      : {
          kana: c[0],
          romaji: c[1],
          ...(c[2] === "obsolete" ? { obsolete: true as const } : {})
        }
  )
});

/**
 * The 46 base kana.
 *
 * The gaps are the point. Modern orthography has no yi/ye or wi/wu/we, and ん belongs to no vowel
 * column at all — so those cells are empty rather than closed up. Closing them would slide う into
 * the "i" column on the や row and break the one thing a chart is for: reading down a column and
 * getting a consistent vowel.
 */
const GOJUON: KanaSection = {
  id: "gojuon",
  label: "Gojūon",
  columns: ["a", "i", "u", "e", "o"],
  rows: [
    row(["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"]),
    row(["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"]),
    // shi/chi/tsu/fu keep their Hepburn spellings rather than being regularised to si/ti/tu/hu:
    // Hepburn is what a learner meets everywhere else, and the chart is for reading, not for
    // showing off the underlying pattern.
    row(["さ", "sa"], ["し", "shi"], ["す", "su"], ["せ", "se"], ["そ", "so"]),
    row(["た", "ta"], ["ち", "chi"], ["つ", "tsu"], ["て", "te"], ["と", "to"]),
    row(["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"]),
    row(["は", "ha"], ["ひ", "hi"], ["ふ", "fu"], ["へ", "he"], ["ほ", "ho"]),
    row(["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"]),
    row(["や", "ya"], undefined, ["ゆ", "yu"], undefined, ["よ", "yo"]),
    row(["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"]),
    // ゐ/ゑ sit in the i and e columns they historically occupied — that placement is the reason to
    // carry them at all, since it is what makes the わ row legible as a row rather than two
    // stranded kana. wu never existed as a distinct kana, so that cell stays a genuine gap.
    row(
      ["わ", "wa"],
      ["ゐ", "wi", "obsolete"],
      undefined,
      ["ゑ", "we", "obsolete"],
      ["を", "wo"]
    ),
    row(["ん", "n"], undefined, undefined, undefined, undefined)
  ]
};

/**
 * Voiced (dakuten) and semi-voiced (handakuten) kana.
 *
 * ぢ and づ are romanised ji and zu — the same as じ and ず, which is not a mistake in the table but
 * a fact about the modern language. Learners hit this exact collision, so showing it is more useful
 * than inventing di/du to keep the column tidy.
 */
const DAKUTEN: KanaSection = {
  id: "dakuten",
  label: "Dakuten",
  columns: ["a", "i", "u", "e", "o"],
  rows: [
    row(["が", "ga"], ["ぎ", "gi"], ["ぐ", "gu"], ["げ", "ge"], ["ご", "go"]),
    row(["ざ", "za"], ["じ", "ji"], ["ず", "zu"], ["ぜ", "ze"], ["ぞ", "zo"]),
    row(["だ", "da"], ["ぢ", "ji"], ["づ", "zu"], ["で", "de"], ["ど", "do"]),
    row(["ば", "ba"], ["び", "bi"], ["ぶ", "bu"], ["べ", "be"], ["ぼ", "bo"]),
    row(["ぱ", "pa"], ["ぴ", "pi"], ["ぷ", "pu"], ["ぺ", "pe"], ["ぽ", "po"])
  ]
};

/**
 * Digraphs (yōon): an i-column kana plus a small ya/yu/yo.
 *
 * Three columns, not five — the pattern only combines with those three vowels. A separate section
 * rather than extra columns on the gojūon table, because the headings genuinely differ and a
 * 5-column grid with two permanently empty columns reads as missing data.
 */
const YOON: KanaSection = {
  id: "yoon",
  label: "Yōon",
  columns: ["ya", "yu", "yo"],
  rows: [
    row(["きゃ", "kya"], ["きゅ", "kyu"], ["きょ", "kyo"]),
    row(["しゃ", "sha"], ["しゅ", "shu"], ["しょ", "sho"]),
    row(["ちゃ", "cha"], ["ちゅ", "chu"], ["ちょ", "cho"]),
    row(["にゃ", "nya"], ["にゅ", "nyu"], ["にょ", "nyo"]),
    row(["ひゃ", "hya"], ["ひゅ", "hyu"], ["ひょ", "hyo"]),
    row(["みゃ", "mya"], ["みゅ", "myu"], ["みょ", "myo"]),
    row(["りゃ", "rya"], ["りゅ", "ryu"], ["りょ", "ryo"]),
    row(["ぎゃ", "gya"], ["ぎゅ", "gyu"], ["ぎょ", "gyo"]),
    row(["じゃ", "ja"], ["じゅ", "ju"], ["じょ", "jo"]),
    row(["びゃ", "bya"], ["びゅ", "byu"], ["びょ", "byo"]),
    row(["ぴゃ", "pya"], ["ぴゅ", "pyu"], ["ぴょ", "pyo"])
  ]
};

export const KANA_CHART: readonly KanaSection[] = [GOJUON, DAKUTEN, YOON];

/**
 * Hiragana → katakana, by codepoint.
 *
 * The two blocks are laid out identically 0x60 apart, small kana included, so a digraph converts
 * character by character with no special case. Scoped to ぁ-ゖ so anything else (the romaji, a
 * stray space) passes through untouched.
 */
export const toKatakana = (text: string): string =>
  text.replace(/[ぁ-ゖ]/gu, (ch) =>
    String.fromCodePoint((ch.codePointAt(0) ?? 0) + 0x60)
  );

export type KanaScript = "hiragana" | "katakana";

/** One cell's kana in the requested script — the chart is stored in hiragana only. */
export const inScript = (kana: string, script: KanaScript): string =>
  script === "hiragana" ? kana : toKatakana(kana);
