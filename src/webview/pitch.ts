/**
 * Pitch-accent geometry: turn a kana reading + an accent number into per-mora high/low + downstep
 * marks, so the UI can draw the Shirabe-style overline/downstep contour. Pure functions, unit-tested.
 *
 * A *mora* is the timing unit Japanese pitch attaches to — not a character. Small ゃゅょ (yōon) and
 * the small ゎ combine with the preceding kana into one mora (きょ = 1 mora); everything else
 * (including small っ sokuon and the long-vowel ー) is its own mora.
 *
 * The accent number N (Tokyo-dialect convention):
 *   - N = 0 (heiban): mora 1 low, all following moras high, no drop.
 *   - N = 1 (atamadaka): mora 1 high, the rest low (drop right after mora 1).
 *   - N ≥ 2 (nakadaka/odaka): mora 1 low, moras 2..N high, drop after mora N.
 * The particle after the word would be low when there's a drop; heiban stays high into the particle.
 */

// Small kana that fuse onto the previous mora (yōon + small ゎ). Small っ and ー are NOT here —
// they carry their own mora.
const COMBINING = new Set([
  "ゃ",
  "ゅ",
  "ょ",
  "ゎ",
  "ャ",
  "ュ",
  "ョ",
  "ヮ",
  // small vowels used in loanword yōon (ファ, ティ, …)
  "ぁ",
  "ぃ",
  "ぅ",
  "ぇ",
  "ぉ",
  "ァ",
  "ィ",
  "ゥ",
  "ェ",
  "ォ"
]);

/** Split a kana reading into moras (each a 1–2 char string). */
export const toMoras = (reading: string): string[] => {
  const moras: string[] = [];
  for (const ch of reading) {
    if (COMBINING.has(ch) && moras.length > 0) {
      moras[moras.length - 1] += ch;
    } else {
      moras.push(ch);
    }
  }
  return moras;
};

export interface MoraPitch {
  mora: string;
  /** true = high pitch (overline), false = low. */
  high: boolean;
  /** true when the pitch drops *after* this mora (the downstep). */
  drop: boolean;
}

/**
 * Derive the per-mora high/low contour and the downstep position for one accent pattern. `accent`
 * is the mora number from the data (0 = heiban). Returns one entry per mora, in order.
 */
export const pitchContour = (reading: string, accent: number): MoraPitch[] => {
  const moras = toMoras(reading);
  return moras.map((mora, i) => {
    const pos = i + 1; // 1-indexed mora position
    let high: boolean;
    if (accent === 0) {
      // heiban: low on mora 1, high thereafter, no drop.
      high = pos > 1;
    } else if (accent === 1) {
      // atamadaka: high on mora 1 only.
      high = pos === 1;
    } else {
      // nakadaka/odaka: low on mora 1, high through the accent mora, low after.
      high = pos > 1 && pos <= accent;
    }
    // The drop sits after the accent mora (never for heiban, which has no drop).
    const drop = accent > 0 && pos === accent;
    return { mora, high, drop };
  });
};
