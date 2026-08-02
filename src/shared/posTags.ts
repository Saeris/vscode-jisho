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
const USAGE_LABEL: Record<string, string | undefined> = {
  uk: "「kana」", // word usually written using kana alone
  uK: "「kanji」", // word usually written using kanji alone
  "on-mim": "擬音語", // onomatopoeic or mimetic word
  hon: "尊敬語", // honorific or respectful (sonkeigo) language
  hum: "謙譲語", // humble (kenjougo) language
  pol: "丁寧語", // polite (teineigo) language
  yoji: "四字熟語", // yojijukugo (four-character compound)
  proverb: "諺", // proverb
  quote: "引用", // quotation
  "male-sl": "male slang",
  "net-sl": "net slang",
  chn: "children's"
};

/** The label to show on a pill: short form where one exists, else the JMdict description. */
export const usageLabel = (code: string, description: string): string =>
  USAGE_LABEL[code] ?? description;

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
