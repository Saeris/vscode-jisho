// The precision scorer for the hand-judged gold corpus (spec 12 §3).
//
// It drives the REAL editor pipeline — the same path a hover takes — so the number it reports is
// the resolution accuracy a user actually sees:
//
//   segment(sentence)  →  for each gold word, the segment carrying it  →  resolveByLemma(lemma, pos)
//
// It does NOT re-implement resolution; it calls the shipped tokenizer and Dictionary. A gold word
// PASSES when the resolved entry's headword equals the hand-judged `expect` (kanji writing or the
// usually-kana form). Optional (genuinely-ambiguous) words are scored separately and never fail.

import type { Dictionary } from "../../db";
import { segment } from "../../tokenizer";
import type { GoldCase, GoldWord, Register } from "./gold";

export interface WordOutcome {
  sentence: string;
  register: Register;
  word: GoldWord;
  /** The headword the pipeline resolved to, or null when nothing resolved / no segment matched. */
  resolved: string | null;
  status:
    | "pass"
    | "fail"
    | "unmatched-segment"
    | "optional-pass"
    | "optional-fail";
}

export interface Score {
  outcomes: WordOutcome[];
  /** Decidable (non-optional) words: the precision the gate tracks. */
  decidable: number;
  passed: number;
  /** decidable ? passed / decidable : 1 — precision over words with a definite right answer. */
  precision: number;
  /** Regression cases (spec 12 §3) that failed — any of these failing hard-fails the gate. */
  regressionFailures: string[];
}

interface FoundSegment {
  lemma: string;
  pos: Parameters<Dictionary["resolveByLemma"]>[1];
  reading: string;
}

/**
 * Locate the segment carrying a gold word, mirroring how a hover finds the word under the cursor.
 * The tokenizer folds conjugation and suffixal する into one segment (勉強しなさい→勉強), but it also
 * SPLITS a te/nai-form: 待って tokenizes as 待っ (lemma 待つ) + て. So a gold surface matches a segment
 * when either contains the other — 勉強 ⊂ 勉強しなさい, and 待っ ⊂ 待って — preferring the segment whose
 * surface length is closest to the gold word (the most specific unit). Returns the segment's
 * dictionary form, coarse POS, and reading, exactly what the hover feeds resolveByLemma.
 */
const findWord = async (
  sentence: string,
  surface: string
): Promise<FoundSegment | null> => {
  const segments = await segment(sentence);
  const exact = segments.find((s) => s.surface === surface);
  if (exact)
    return { lemma: exact.lemma, pos: exact.pos, reading: exact.reading };
  // Overlapping segment: gold contains the segment (conjugation split off) or segment contains gold
  // (conjugation/する folded in). Rank by how close the surfaces are in length; ties → shorter.
  const overlapping = segments
    .filter((s) => s.surface.includes(surface) || surface.includes(s.surface))
    .sort(
      (a, b) =>
        Math.abs(a.surface.length - surface.length) -
        Math.abs(b.surface.length - surface.length)
    );
  const seg = overlapping[0];
  return seg ? { lemma: seg.lemma, pos: seg.pos, reading: seg.reading } : null;
};

/** Resolve one gold word through the real pipeline and classify the outcome. */
const scoreWord = async (
  dict: Dictionary,
  gold: GoldCase,
  word: GoldWord
): Promise<WordOutcome> => {
  const base = { sentence: gold.sentence, register: gold.register, word };
  const found = await findWord(gold.sentence, word.surface);
  if (found === null) {
    // The tokenizer didn't produce a segment we could tie to this word — a tokenizer/gold mismatch,
    // surfaced (not silently passed) so the corpus stays honest.
    return { ...base, resolved: null, status: "unmatched-segment" };
  }
  const match = await dict.resolveByLemma(
    found.lemma,
    found.pos,
    found.reading
  );
  const resolved = match?.headword ?? null;
  const ok = resolved === word.expect;
  if (word.optional) {
    return {
      ...base,
      resolved,
      status: ok ? "optional-pass" : "optional-fail"
    };
  }
  return { ...base, resolved, status: ok ? "pass" : "fail" };
};

export const scoreCorpus = async (
  dict: Dictionary,
  corpus: GoldCase[]
): Promise<Score> => {
  const outcomes: WordOutcome[] = [];
  for (const gold of corpus) {
    for (const word of gold.words) {
      outcomes.push(await scoreWord(dict, gold, word));
    }
  }
  const decidableOutcomes = outcomes.filter(
    (o) =>
      o.status === "pass" ||
      o.status === "fail" ||
      o.status === "unmatched-segment"
  );
  const passed = decidableOutcomes.filter((o) => o.status === "pass").length;
  const decidable = decidableOutcomes.length;
  const regressionFailures = corpus
    .filter(
      (c) =>
        c.regression !== undefined &&
        outcomes.some(
          (o) =>
            o.sentence === c.sentence &&
            (o.status === "fail" || o.status === "unmatched-segment")
        )
    )
    .map((c) => `${c.regression!} — ${c.sentence}`);
  return {
    outcomes,
    decidable,
    passed,
    precision: decidable === 0 ? 1 : passed / decidable,
    regressionFailures
  };
};

/** Per-register precision, for the report line that makes a casual-text regression visible. */
export const precisionByRegister = (
  outcomes: WordOutcome[]
): Record<Register, { passed: number; decidable: number }> => {
  const acc: Record<Register, { passed: number; decidable: number }> = {
    casual: { passed: 0, decidable: 0 },
    formal: { passed: 0, decidable: 0 },
    literary: { passed: 0, decidable: 0 }
  };
  for (const o of outcomes) {
    if (o.status === "pass") {
      acc[o.register].passed++;
      acc[o.register].decidable++;
    } else if (o.status === "fail" || o.status === "unmatched-segment") {
      acc[o.register].decidable++;
    }
  }
  return acc;
};
