/**
 * THE AUTHORED STANDARD PALETTE — hand-built by the extension's author in Figma via Harmonizer,
 * and adopted wholesale. It measures better than anything the optimiser produced, and the reasons
 * are worth recording because they are the lessons of this whole exercise.
 *
 * 1. TWO ORTHOGONAL SEMANTIC AXES. Four clusters at 45° / 135° / 225° / 315°:
 *
 *                     actions (45°)
 *                          │
 *      structure (135°) ───┼─── modifier (315°)
 *                          │
 *                     things (225°)
 *
 *    things ↔ actions and modifier ↔ structure are BOTH exactly 180° opposed (measured, not
 *    approximated). Members sit ~44° apart inside their cluster, so every cross-axis pair lands
 *    near-complementary while every within-cluster pair stays a family.
 *
 * 2. UTTERANCE IS STRUCTURE, not its own cluster. Verified against 25,000 sentences: utterance-class
 *    words (感動詞/フィラー/接続詞) are sentence-INITIAL 38.0% of the time and medial 57.8%, while
 *    particles are sentence-initial 0.0% and medial 97.3%. Neither ends a sentence (4.2% / 2.7%).
 *    Both divide and frame — they simply do it at different scales, so they share a cluster and sit
 *    44° apart within it.
 *
 * 3. UNIFORM APCA, NOT UNIFORM LIGHTNESS. Every colour lands at Lc 70.2–71.0 (spread 0.8). Lightness
 *    VARIES slightly (0.842–0.862) precisely so that perceived contrast does not. The optimiser held
 *    L constant and let contrast drift, which is backwards: contrast is the thing a reader perceives.
 *
 * 4. CHROMA PINNED TO THE MOST CONSTRAINED HUE. C spans 0.075–0.081 (sd 0.0018), and several hues sit
 *    exactly AT their gamut ceiling (verb 0.077/0.077, noun 0.079/0.079, adnominal 0.075/0.075). No
 *    hue is over-saturated relative to its neighbours, so no word out-shouts another in running text.
 *
 * Measured against the optimiser's best (candidate J): noun↔verb 29.4 deutan here vs ~8 there;
 * particle↔noun 36.9 vs ~9. The semantic structure was not a constraint ON separation — it WAS the
 * source of it.
 */

/**
 * 5. A 16-STEP HUE GRID. The first six categories sit on ODD multiples of 22.5° (= 360/16):
 *    verb 1x, auxiliary 3x, particle 5x, utterance 7x, pronoun 9x, noun 11x — a perfect 45° cadence,
 *    which is what makes every cross-axis pair land exactly complementary. The three MODIFIERS then
 *    compress into the remaining arc (285 / 315 / 345, gaps of 37.5° / 30° / 30°) because three
 *    members must fit a slot sized for two. That is the right trade: the modifier cluster is the
 *    rarest by a wide margin (adnominal 1.38% + adjective 1.51% + adverb 1.81% = 4.7% of tokens),
 *    so it can afford the tightest spacing in the palette.
 *
 * Values below are the EXACT oklch() the author's tool emitted — not round-tripped through hex,
 * which had already clamped some hues in sRGB and made chroma look uneven (0.075-0.081) when the
 * source is a single flat value per ground.
 */
export const AUTHORED = {
  // key          dark                          light                        cluster    hue
  utterance: ["oklch(0.84 0.08 157.5)", "oklch(0.52 0.12 157.5)"], // structure 157.5°  (7 x 22.5)
  pronoun: ["oklch(0.84 0.08 202.5)", "oklch(0.52 0.12 202.5)"], // things    202.5°  (9 x 22.5)
  noun: ["oklch(0.85 0.08 247.5)", "oklch(0.54 0.12 247.5)"], // things    247.5°  (11 x 22.5)
  adnominal: ["oklch(0.86 0.08 285)", "oklch(0.55 0.12 285)"], // modifier  285°
  adjective: ["oklch(0.86 0.08 315)", "oklch(0.55 0.12 315)"], // modifier  315°
  adverb: ["oklch(0.86 0.08 345)", "oklch(0.55 0.12 345)"], // modifier  345°
  verb: ["oklch(0.86 0.08 22.5)", "oklch(0.55 0.12 22.5)"], // actions    22.5°  (1 x 22.5)
  auxiliary: ["oklch(0.86 0.08 67.5)", "oklch(0.54 0.12 67.5)"], // actions    67.5°  (3 x 22.5)
  particle: ["oklch(0.85 0.08 112.5)", "oklch(0.53 0.12 112.5)"] // structure 112.5°  (5 x 22.5)
};

/** Grounds the authored palette was designed against. */
export const AUTHORED_BG = { dark: "#39302c", light: "#faf9f8" };
export const AUTHORED_FG = { dark: "#faf9f8", light: "#39302c" };

export const CLUSTER_OF = {
  pronoun: "things",
  noun: "things",
  adnominal: "modifier",
  adjective: "modifier",
  adverb: "modifier",
  verb: "actions",
  auxiliary: "actions",
  particle: "structure",
  utterance: "structure"
};

/** Cluster centres, from the authored hues. Both axes are exactly 180° opposed. */
export const CLUSTER_CENTRE = {
  actions: 45,
  structure: 135,
  things: 225,
  modifier: 315
};
