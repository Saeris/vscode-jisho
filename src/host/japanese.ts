/**
 * Script tests shared by the host's text features.
 *
 * NOTE (2026-07-29): this file is a MOVE, not yet a consolidation. At least three different
 * definitions of "kanji" exist in the tree and they disagree:
 *
 *   * this one, `[㐀-鿿豈-﫿]` — CJK ideographs plus the compatibility block, no iteration marks;
 *   * `shared/ruby.ts`'s `KANJI`, `[㐀-鿿々〆]` — iteration marks INCLUDED, compatibility block NOT;
 *   * `hover.ts`'s `JA_RUNS`, which spans kana too because it is finding runs, not testing script.
 *
 * The first two are the same question answered differently, which means 人々 aligns for furigana but
 * a lone 々 does not gate tokenization, and a compatibility ideograph is kanji to one and not the
 * other. Reconciling them needs a decision about what each caller actually means, so it is recorded
 * as a finding rather than guessed at here.
 */

/**
 * Whether text contains at least one kanji.
 *
 * The tokenizer needs this: IPADIC's lattice relies on kanji↔kana script transitions to find word
 * boundaries, so all-kana input (にほんごをはなしますか) has no boundary signal and segments into
 * garbage. Features gate on it and fall back rather than acting on bad segmentation.
 */
export const HAS_KANJI = /[㐀-鿿豈-﫿]/;
