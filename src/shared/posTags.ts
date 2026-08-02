/**
 * The shared vocabulary for rendering JMdict tags as compact pills.
 *
 * Both surfaces read from here so a part of speech looks and reads the same everywhere: the hover
 * (`<kbd>` pills, restricted to VS Code's markdown subset) and the word page (styled chips, which
 * can additionally carry the palette hue). Previously only the hover had this mapping, and the page
 * spelled every tag out in full — それぞれ rendered as "adverb (fukushi), noun (common)
 * (futsuumeishi), nouns which may take the genitive case particle 'no', word usually written using
 * kana alone" (BACKLOG #50).
 */
import type { PartOfSpeech } from "./messages";

/** JMdict POS code → its Japanese label. Codes outside these families fall back to English. */
const POS_LABEL: Record<string, string | undefined> = {
  n: "名詞",
  "n-adv": "副詞的名詞",
  "n-t": "時相名詞",
  "n-suf": "接尾名詞",
  "n-pref": "接頭名詞",
  pn: "代名詞",
  adv: "副詞",
  "adv-to": "と副詞",
  vk: "不規則動詞", // 来る
  vn: "不規則動詞", // 死ぬ-type ナ変
  vr: "不規則動詞",
  vz: "一段動詞", // ずる (一段-adjacent)
  vi: "自動詞",
  vt: "他動詞",
  aux: "助動詞",
  "aux-v": "助動詞",
  "aux-adj": "補助形容詞",
  cop: "繋辞",
  "cop-da": "繋辞",
  prt: "助詞",
  conj: "接続詞",
  int: "感動詞",
  exp: "表現",
  pref: "接頭辞",
  suf: "接尾辞",
  ctr: "助数詞",
  num: "数詞",
  unc: "未分類"
};

/**
 * The Japanese label for a JMdict POS code.
 *
 * Prefers the explicit table, then derives from the code's STRUCTURE for the large regular families
 * — every `v5*` is a 五段動詞, `v1*` a 一段動詞, `v4*`/`v2*` classical 四段/二段 verbs, `vs*` a
 * する動詞, `adj-*` an adjective class — so a newly-seen code in a known family resolves rather than
 * falling through. That structural fallback is what fixes the reported bug (v5r-i showed English
 * because the old table listed codes one by one and missed it). Anything genuinely outside these
 * families returns null and the caller shows the English description.
 */
export const posLabel = (code: string): string | null => {
  const explicit = POS_LABEL[code];
  if (explicit !== undefined) return explicit;
  if (code.startsWith("v5")) return "五段動詞";
  if (code.startsWith("v1")) return "一段動詞";
  if (code.startsWith("v4")) return "四段動詞"; // classical yodan
  if (code.startsWith("v2")) return "二段動詞"; // classical nidan
  if (code.startsWith("vs")) return "する動詞";
  if (/^adj-i(x)?$/u.test(code)) return "い形容詞";
  if (code === "adj-na" || code === "adj-nari") return "な形容詞";
  if (code === "adj-no") return "の形容詞";
  if (code === "adj-pn") return "連体詞";
  if (code.startsWith("adj-")) return "形容詞"; // taru/ku/shiku/f… archaic classes
  return null;
};

/**
 * SHORT ENGLISH labels for POS codes, for readers who do not (yet) know the Japanese grammatical
 * terms. This is the default, because 名詞 is only compact if you already read it.
 *
 * Curated rather than taken from JMdict's descriptions, which are annotated for a dictionary editor
 * and do not fit a pill: `n` — the most common tag in the dictionary at 27,384 senses — is "noun
 * (common) (futsuumeishi)", and `adj-no` is "nouns which may take the genitive case particle 'no'".
 * The parenthetical romaji also just duplicates what the Japanese label already says.
 *
 * The full JMdict description is the tooltip in BOTH modes, so neither loses information.
 */
const POS_LABEL_EN: Record<string, string | undefined> = {
  n: "noun",
  "n-adv": "adverbial noun",
  "n-t": "temporal noun",
  "n-suf": "noun suffix",
  "n-pref": "noun prefix",
  pn: "pronoun",
  adv: "adverb",
  "adv-to": "と adverb",
  vk: "irregular verb", // 来る
  vn: "irregular verb", // 死ぬ-type ナ変
  vr: "irregular verb",
  vz: "ichidan verb", // ずる (一段-adjacent)
  vi: "intransitive",
  vt: "transitive",
  aux: "auxiliary",
  "aux-v": "auxiliary verb",
  "aux-adj": "auxiliary adjective",
  cop: "copula",
  "cop-da": "copula",
  prt: "particle",
  conj: "conjunction",
  int: "interjection",
  exp: "expression",
  pref: "prefix",
  suf: "suffix",
  ctr: "counter",
  num: "numeric",
  unc: "unclassified"
};

/** English counterpart to `posLabel`, with the same structural fallbacks for the verb families. */
const posLabelEn = (code: string): string | null => {
  const explicit = POS_LABEL_EN[code];
  if (explicit !== undefined) return explicit;
  if (code.startsWith("v5")) return "godan verb";
  if (code.startsWith("v1")) return "ichidan verb";
  if (code.startsWith("v4")) return "yodan verb"; // classical
  if (code.startsWith("v2")) return "nidan verb"; // classical
  if (code.startsWith("vs")) return "suru verb";
  if (/^adj-i(x)?$/u.test(code)) return "い adjective";
  if (code === "adj-na" || code === "adj-nari") return "な adjective";
  if (code === "adj-no") return "の adjective";
  if (code === "adj-pn") return "prenominal";
  if (code.startsWith("adj-")) return "adjective";
  return null;
};

/** Which label vocabulary a pill uses. */
export type TagLabelStyle = "english" | "japanese";

/**
 * The label for a POS pill in the requested style.
 *
 * Falls back across styles rather than to the raw description: a code with no Japanese label but a
 * known English one still reads better as "expression" than as JMdict's full sentence.
 */
export const posPillLabel = (
  code: string,
  description: string,
  style: TagLabelStyle
): string =>
  (style === "japanese"
    ? (posLabel(code) ?? posLabelEn(code))
    : (posLabelEn(code) ?? posLabel(code))) ?? description;

/**
 * Short labels for the few USAGE tags whose JMdict description is too long to be a pill.
 *
 * Deliberately a short list rather than a general rule. Measured over the shipped dictionary, the
 * misc vocabulary is already pill-sized almost everywhere — "abbreviation", "colloquial",
 * "archaic", "slang" — and field and dialect tags ("computing", "baseball", "Kansai-ben") need
 * nothing at all. Only these are genuinely unwieldy, and `uk` is by far the most common tag in the
 * whole set (2,360 senses), which is why it looked like a general problem.
 *
 * The full description always survives as the pill's tooltip, so nothing is lost by shortening.
 */
const USAGE_LABEL: Record<string, { en: string; ja: string } | undefined> = {
  uk: { en: "kana", ja: "「kana」" }, // word usually written using kana alone
  uK: { en: "kanji", ja: "「kanji」" }, // word usually written using kanji alone
  "on-mim": { en: "mimetic", ja: "擬音語" }, // onomatopoeic or mimetic word
  hon: { en: "honorific", ja: "尊敬語" }, // sonkeigo
  hum: { en: "humble", ja: "謙譲語" }, // kenjougo
  pol: { en: "polite", ja: "丁寧語" }, // teineigo
  yoji: { en: "four-char", ja: "四字熟語" }, // yojijukugo
  proverb: { en: "proverb", ja: "諺" },
  quote: { en: "quotation", ja: "引用" },
  "male-sl": { en: "male slang", ja: "男性語" },
  "net-sl": { en: "net slang", ja: "ネット語" },
  chn: { en: "children's", ja: "幼児語" }
};

/**
 * The label for a usage pill: the short form where one exists, else the JMdict description.
 *
 * Most usage tags need no mapping at all — "abbreviation", "colloquial", "archaic", "slang",
 * "computing", "Kansai-ben" are already pill-sized in English, and in Japanese mode they simply
 * stay English rather than inventing a translation the dictionary does not carry.
 */
export const usageLabel = (
  code: string,
  description: string,
  style: TagLabelStyle = "english"
): string => {
  const entry = USAGE_LABEL[code];
  if (entry === undefined) return description;
  return style === "japanese" ? entry.ja : entry.en;
};

/**
 * Map a JMdict POS code onto the palette category that colours it.
 *
 * Returning `undefined` leaves a pill neutral, which is the right default: usage, field and
 * dialect tags are not parts of speech, and giving them palette hues would imply a grammatical
 * meaning they do not carry. Only genuine POS codes get a hue, and it is the SAME hue that word
 * wears in the breakdown bar and in the editor — that consistency is the point of #50.
 */
export const posCategory = (code: string): PartOfSpeech | undefined => {
  if (code === "pn") return "pronoun";
  if (code === "n" || code.startsWith("n-")) return "noun";
  if (code === "adj-pn") return "adnominal";
  if (code.startsWith("adj")) return "adjective";
  if (code === "adv" || code.startsWith("adv-")) return "adverb";
  if (code === "prt") return "particle";
  if (code === "int" || code === "conj" || code === "exp") return "utterance";
  if (code.startsWith("aux") || code.startsWith("cop")) return "auxiliary";
  // Every remaining verb family: v1/v2/v4/v5/vk/vn/vr/vs/vz plus the transitivity markers.
  if (/^v[0-9krsznt]/u.test(code) || code === "vi") return "verb";
  return undefined;
};
