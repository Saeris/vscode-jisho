/**
 * Bridge the tokenizer's COARSE part-of-speech (verb/noun/adjective/…) to JMdict's FINE POS codes
 * (v1, v5r, adj-i, n-suf, …). Used to disambiguate a hover lookup: when the tokenizer says a word is
 * a verb, an entry whose senses are all nouns is the wrong match even if the reading collides
 * (し → the verb する, not the noun 死).
 */
import type { PartOfSpeech } from "./messages";

/** Narrow a raw string to a PartOfSpeech, or "other" when it isn't one of the known categories. */
export const asPartOfSpeech = (raw: string): PartOfSpeech => {
  switch (raw) {
    case "verb":
    case "noun":
    case "adjective":
    case "adverb":
    case "particle":
    case "auxiliary":
      return raw;
    default:
      return "other";
  }
};

/**
 * Whether a JMdict POS code is compatible with a coarse tokenizer POS. Deliberately permissive within
 * a category (all `v*` verb classes count as "verb") — the goal is to REJECT a cross-category match
 * (noun vs verb), not to distinguish godan from ichidan.
 */
export const posMatches = (coarse: PartOfSpeech, code: string): boolean => {
  switch (coarse) {
    case "verb":
      // v1, v2*, v5*, vk, vr, vs*, vz, plus the transitivity markers vi/vt.
      return (
        /^v[0-9]/.test(code) ||
        /^v[krsz]/.test(code) ||
        code === "vi" ||
        code === "vt"
      );
    case "adjective":
      return code.startsWith("adj");
    case "adverb":
      return code.startsWith("adv");
    case "noun":
      // Plain noun, noun-prefix/suffix, pronoun, numeric, counter — all "noun-ish" to the tokenizer.
      return (
        code === "n" ||
        code.startsWith("n-") ||
        code === "pn" ||
        code === "num" ||
        code === "ctr"
      );
    case "pronoun":
      // JMdict marks pronouns `pn`, but many are also (or only) tagged as plain nouns, so accept
      // both: rejecting `n` here would make 彼 and それ fail to resolve.
      return code === "pn" || code === "n";
    case "adnominal":
      // 連体詞 (この, その, 大きな). JMdict's closest tag is `adj-pn` (pre-noun adjectival).
      return code === "adj-pn" || code.startsWith("adj");
    case "particle":
      return code === "prt";
    case "utterance":
      // 感動詞 / フィラー, plus the conjunctions folded in here for colouring. JMdict: `int`
      // (interjection), `conj` (conjunction), `exp` (expression — many greetings are tagged this).
      return code === "int" || code === "conj" || code === "exp";
    case "auxiliary":
      return code.startsWith("aux") || code === "cop";
    case "other":
      // No constraint — the tokenizer couldn't categorize it, so don't filter on POS.
      return true;
  }
};

/** Whether ANY of an entry's sense POS codes is compatible with the coarse tokenizer POS. */
export const anyPosMatches = (
  coarse: PartOfSpeech,
  codes: readonly string[]
): boolean => codes.some((c) => posMatches(coarse, c));
