/**
 * Building blocks for the rich word/kanji hover, written against VS Code's verified hover-HTML
 * surface: the markdown renderer allows a fixed set of tags (h1–h6, span, ruby, kbd, ins, small,
 * details, blockquote, …) and STRIPS every `style`/`class`/`color` attribute — confirmed against
 * the shipped renderer's allowlist and a live hover. Size and emphasis therefore come only from
 * semantic elements, and the one styling channel left is a tag's own themed appearance.
 *
 * The two levers this module uses:
 *   - `<kbd>` renders as a themed box (border + subtle background) — the closest thing to a "pill"
 *     available without CSS. A Japanese label keeps it compact; the English rides in `title`.
 *   - `title` on `<kbd>`/`<ins>` shows a native tooltip, so a gloss (the English POS, a
 *     conjugation's full name) is one hover away without spending layout width.
 */

/**
 * Escape a string for use inside an HTML attribute value (the `title=""`).
 *
 * Only the attribute path needs this: element *content* is Japanese/English text that the markdown
 * renderer already handles, but an unescaped `"` or `<` in a title would break out of the attribute.
 */
const escapeAttr = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * JMdict part-of-speech code → compact Japanese pill label — the codes that don't follow a
 * structural pattern (`posLabel` derives the rest from the code shape).
 *
 * The dictionary only carries the English description ("noun", "suru verb"). A learner scanning a
 * hover reads the Japanese grammatical term faster, and it is far shorter — 名詞 versus "noun",
 * する動詞 versus "noun or participle which takes the aux. verb suru". The English stays available
 * as the pill's `title`.
 */
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
const posLabel = (code: string): string | null => {
  const explicit = POS_LABEL[code];
  if (explicit !== undefined) return explicit;
  if (code.startsWith("v5")) return "五段動詞";
  if (code.startsWith("v1")) return "一段動詞";
  if (code.startsWith("v4")) return "四段動詞"; // classical yodan
  if (code.startsWith("v2")) return "二段動詞"; // classical nidan
  if (code.startsWith("vs")) return "する動詞";
  if (/^adj-i(x)?$/.test(code)) return "い形容詞";
  if (code === "adj-na" || code === "adj-nari") return "な形容詞";
  if (code === "adj-no") return "の形容詞";
  if (code === "adj-pn") return "連体詞";
  if (code.startsWith("adj-")) return "形容詞"; // taru/ku/shiku/f… archaic classes
  return null;
};

/**
 * Render a part-of-speech tag as a `<kbd>` pill: a compact Japanese label with its English
 * description as the hover tooltip. Falls back to the English label when no Japanese one is known.
 */
export const posPill = (code: string, description: string): string => {
  const label = posLabel(code) ?? description;
  return `<kbd title="${escapeAttr(description)}">${label}</kbd>`;
};

/**
 * Render an inline gloss tag as `<ins>`: visible text with a `title` tooltip. Used for a
 * conjugation form on the breakdown line (〜します shown, "Non-past (polite)" on hover), where the
 * short form belongs in the line and the full name would crowd it.
 */
export const glossTag = (text: string, title: string): string =>
  `<ins title="${escapeAttr(title)}">${text}</ins>`;

/** The pieces of a word the hover renders. A trimmed view of the DTO — the renderer stays pure. */
export interface WordHover {
  /** Headword as written (kanji), e.g. 注意. */
  headword: string;
  /** Primary reading in kana, e.g. ちゅうい. Empty for kana-only words. */
  reading: string;
  /** The conjugation breakdown line (from describeGroup), or null when the form is plain. */
  breakdown: string | null;
  senses: HoverSense[];
}

export interface HoverSense {
  partOfSpeech: Array<{ code: string; description: string }>;
  glosses: string[];
  sentences: Array<{ ja: string; en: string }>;
}

/**
 * Compose the word/kanji hover body, following the layout settled on with the user (variant A):
 *
 *   # 〈ruby headword〉      ← h1 so the reading renders as legible furigana, not 7px <rt>
 *   ---                     ← thematic break; the visible rule under the headword
 *   ### 〈breakdown〉         ← h3, only when the form is conjugated; larger than the body
 *   〈gloss〉                 ← the leading sense's meaning, plain body text
 *   〈POS pills〉             ← <kbd> boxes, Japanese label + English title
 *   > 〈example〉             ← blockquote, the sense's first Tatoeba sentence
 *   > 〈translation〉         ← dimmed via <small>
 *   ---
 *   [Open in Jisho]         ← the trusted command link
 *
 * One sense only, by design: the hover is height-constrained, and the first sense plus one example
 * is the useful glance. The full entry is one click away via the link.
 */
export const wordHoverMarkdown = (word: WordHover): string => {
  const parts: string[] = [
    `# ${rubyHeading(word.headword, word.reading)}`,
    "---"
  ];

  if (word.breakdown !== null) parts.push(`### ${word.breakdown}`);

  // `senses[0]` on an empty array is undefined at runtime; the array type doesn't say so, so guard
  // on length rather than a truthiness check the compiler thinks is redundant.
  if (word.senses.length > 0) {
    const [sense] = word.senses;
    // Up to three glosses keeps the meaning readable without turning the line into a thesaurus.
    parts.push(sense.glosses.slice(0, 3).join("; "));
    const pills = sense.partOfSpeech
      .map((p) => posPill(p.code, p.description))
      .join(" ");
    if (pills !== "") parts.push(pills);
    if (sense.sentences.length > 0) {
      const [example] = sense.sentences;
      // Blockquote: the one place the example reads as a quotation rather than more metadata. The
      // translation is dimmed with <small> so the Japanese leads.
      parts.push(`> ${example.ja}  \n> <small>*${example.en}*</small>`);
    }
  }

  return parts.join("\n\n");
};

/**
 * The headword as a ruby heading. Whole-word furigana (`<ruby>注意<rt>ちゅうい</rt></ruby>`) rather
 * than the per-kanji alignment `toRubyHtml` does: a heading is a single visual unit and the
 * reading sits over the whole word, which is how a dictionary headword is furigana'd. No reading
 * (kana-only word) → just the headword.
 */
const rubyHeading = (headword: string, reading: string): string => {
  if (reading === "" || reading === headword) return headword;
  return `<ruby>${headword}<rt>${reading}</rt></ruby>`;
};
