# Colouring Japanese by part of speech — research notes

Working notes behind the part-of-speech palette in `vscode-jisho`, kept because the cross-section of
the two research areas — **Japanese corpus linguistics** and **perceptual colour science** — is not
something either field writes about on its own.

The question: _given a Japanese sentence with no spaces between words, can colour make word
boundaries visible — for every reader, including the ~8% of men with a colour-vision deficiency?_

Companion document: [`pos-palette-comparison.md`](pos-palette-comparison.md) renders every candidate
palette against both VS Code grounds, under three dichromacy simulations, over real corpus
sentences. The measurements below are reproducible from `scratchpad/` (see "Reproducing" at the end).

---

## Part 1 — What Japanese actually needs

### 1.1 The categories are set by what the tokenizer can prove, not by grammar textbooks

We tokenize with **Lindera + IPADIC**. IPADIC's top-level tags do not line up with how Japanese is
taught, and two categories a learner cares about are _subcategories_ of 名詞 rather than top-level
tags — so a naive `POS_MAP` keyed only on the top-level tag structurally cannot express them:

| learner category         | IPADIC              | note                                             |
| ------------------------ | ------------------- | ------------------------------------------------ |
| pronoun                  | `名詞,代名詞`       | subcategory of noun                              |
| adjectival noun (な-adj) | `名詞,形容動詞語幹` | subcategory of noun                              |
| adnominal                | `連体詞`            | top-level, but we were mapping it to _adjective_ |
| conjunction              | `接続詞`            | top-level                                        |
| interjection             | `感動詞`            | top-level                                        |

### 1.2 Frequency: measured over the shipped corpus, not assumed

**76,317 sentences / 941,722 tokens** (deduplicated Tatoeba, tokenized by our own tokenizer):

| category              | IPADIC                | % of tokens |
| --------------------- | --------------------- | ----------- |
| noun                  | `名詞` (minus 代名詞) | ~26.4%      |
| particle              | `助詞`                | 29.05%      |
| verb                  | `動詞`                | 13.71%      |
| auxiliary             | `助動詞`              | 10.16%      |
| pronoun               | `名詞,代名詞`         | 5.06%       |
| adverb                | `副詞`                | 1.81%       |
| adjective             | `形容詞`              | 1.51%       |
| adnominal             | `連体詞`              | 1.38%       |
| interjection + filler | `感動詞`, `フィラー`  | 0.14%       |
| _(punctuation)_       | `記号`                | 10.29%      |

**Sample size changed a decision.** An early measurement over ~4,400 tokens (羅生門 + 50 Tatoeba
sentences) put pronouns at 1.8% and conjunctions at 1.3%. At full scale pronouns are **5.06%** — the
6th most common category, more frequent than adverb, adjective and adnominal _combined_ — while
conjunctions fall to **0.17%**. The small sample would have had us drop the wrong category. Literary
prose is also a poor proxy for everyday register: it over-represents conjunctions and barely contains
interjections.

### 1.3 Frequency is the wrong objective — adjacency is the right one

A colour boundary only does work where two categories **touch**. Measuring transitions directly
(672,371 category adjacencies, punctuation excluded, direction ignored since we colour rather than
parse):

| adjacent pair           | share of all boundaries |
| ----------------------- | ----------------------- |
| `noun · particle`       | **41.30%**              |
| `particle · verb`       | 18.57%                  |
| `auxiliary · verb`      | 8.22%                   |
| `particle · pronoun`    | 8.18%                   |
| `auxiliary · noun`      | 5.22%                   |
| `noun · verb`           | 5.10%                   |
| … 30 further pairs      | ~13%                    |
| `adnominal · utterance` | 0.001% (9 occurrences)  |

**The top four pairs are 76% of every boundary a reader meets.** Optimising uniform pairwise
separation spends the hue wheel equally on `noun|particle` and on pairs that never occur.

### 1.4 Semantic clustering beats uniform separation

Design intent from the extension's author, who teaches Japanese: hue should encode **word-class
kinship**, not merely maximise difference.

- **Things** (pronoun, noun) cluster — both refer to entities.
- **Actions** (verb, auxiliary) cluster, opposite Things — auxiliaries almost always trail a verb, so
  the pair should read as _one action unit_.
- **Particles** get maximum isolation: they are the closest thing Japanese has to a word break.
- **Modifiers** (adnominal, adjective, adverb) fill the arc between.

This makes **low within-cluster distance a feature**. The metric to maximise is _cross-cluster_
separation, and the adjacency data supports the intent: `auxiliary·verb` is the 3rd most common
boundary, so that pair must stay distinguishable even while reading as a family.

### 1.5 Uncoloured text is ambiguous, not neutral

An early build left `接頭詞` (お, 大, 新), `接続詞` (しかし) and `感動詞` (もしもし) uncoloured — 11.25%
of tokens. Under dichromacy several palette colours desaturate _toward grey_, so "no category"
becomes confusable with "some category". Everything that is a word now gets a colour:

| IPADIC              | %     | examples             | folded into                  | why                                                                   |
| ------------------- | ----- | -------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `接頭詞`            | 0.35% | お, 大, 新, 第       | **noun**                     | bound morpheme — colouring it as its host makes お話 read as one unit |
| `接続詞`            | 0.24% | しかし, だから       | **particle**                 | joins clauses — structural, exactly what particles do                 |
| `感動詞`/`フィラー` | 0.14% | もしもし, ああ, えと | **utterance** (own category) | sits outside the sentence skeleton                                    |

Only `記号` (punctuation, 10.29%) stays uncoloured — its glyph shape disambiguates it independently.

---

## Part 2 — What perceptual colour science says

### 2.1 ΔE is the wrong primary metric for categorical palettes

The single most important correction. Perceptual distance measures _just-noticeable difference_
between adjacent patches; it does not measure _categorical identification_ in running text.

- **Colorgorical** ([Gramazio, Laidlaw & Schloss, IEEE TVCG 2016][colorgorical]) scores palettes on
  four functions, of which Perceptual Distance is only one. **Name Difference** — do these colours
  have different _names_? — is the one that captures discriminability. Red and pink are perceptually
  close but named differently, so they discriminate well despite low ΔE.
- **Nameability predicts accuracy better than perceptual distance** ([Reda et al., CGF 2021][reda]).
  Increasing _semantic_ distance improved interpretability independent of perceptual distance, and
  the authors explicitly suggest relaxing perceptual-distance constraints in favour of nameability.
- **Perceptual uniformity is not the win it is assumed to be** ([Revisiting Categorical Color
  Perception in Scatterplots, EuroVis 2024][revisiting]): perceptually-uniform palettes with larger
  average step sizes did **not** significantly outperform non-uniform ones.

We reproduced the failure this predicts. An optimiser maximising adjacency-weighted ΔE produced a
palette scoring well numerically (weighted deutan ΔE 14.0, best of six candidates) that was
immediately rejected on sight as "the most perceptually monotone of all the palettes so far". It had
collapsed nine hues into a **95° arc** with two categories **1° apart**, buying every boundary with
lightness. Circular hue variance: **0.431**, against 0.82–0.94 for every hand-built candidate.

**Berlin & Kay is a sufficient basis for the naming constraint.** Heer & Stone's probabilistic model
— built on ~3M XKCD naming judgements — _replicates_ [Berlin & Kay's 11 basic colour terms][bk], so
anchoring to those terms is not a cheap approximation of the naming data; it is the equilibrium that
data converges to.

### 2.2 Constraints must be constraints, not terms in a sum

[Petroff (2021)][petroff] treats accessibility as a **feasible region** and optimises aesthetic
preference _inside_ it: minimum perceptual distance (including under CVD simulation), minimum
lightness distance for greyscale, maximum lightness for ground contrast, plus colour-saliency scores
"for ease of use of the colours in verbal and written descriptions".

Published thresholds (CAM02-UCS):

| colours | min lightness distance | min colour distance |
| ------- | ---------------------- | ------------------- |
| 6       | 5.0                    | 20                  |
| 8       | 4.2                    | 18                  |
| 10      | 3.6                    | 16                  |

Our first attempt targeted **ΔE 5–8 in OKLab** and declared success. Measured on the same pairs,
CIEDE2000 runs ~2.3–2.7× OKLab ΔE — so we were at roughly 12–18 CIEDE2000, near the bar but unable
to see it, because we were comparing across scales. Summing constraints with preferences also let
the optimiser trade hue variety for ΔE, which is precisely what it did.

### 2.3 Ström's loss function: mean _and_ range

[Matthew Ström, "How to pick the least wrong colors"][strom] runs the same simulated-annealing
approach, with two terms ours lacked:

1. **Maximise average distance AND minimise its range** — diversity _and_ uniformity. Without the
   range term, colours cluster: a few well-separated pairs offset many collapsed ones.
2. **CVD scores weighted by prevalence**, not equally. Deuteranomaly is ~30× more common than
   tritanopia; weighting the three equally spends the budget on the rarest condition.

Reported result: a 12-colour palette with 7 total JND issues across all vision types, against Adobe
(14), IBM (21), D3 (29). The method works when the loss function is right.

### 2.4 Chroma must be relative to the gamut, not absolute

From [meodai's colour-expert notes][colorexpert], the canonical OKLCH mistake is "picking a chroma
that doesn't exist in the target gamut". Measured at L=0.78 in sRGB, the chroma ceiling varies **2×**
by hue:

| hue  | name     | max chroma (sRGB) | max chroma (P3) | P3 gain |
| ---- | -------- | ----------------- | --------------- | ------- |
| 145° | green    | 0.245             | 0.333           | +36%    |
| 350° | pink     | 0.154             | 0.201           | +31%    |
| 100° | yellow   | 0.162             | 0.188           | +16%    |
| 190° | teal     | 0.135             | 0.182           | +35%    |
| 255° | **blue** | **0.114**         | **0.124**       | **+9%** |

A flat `C: 0.085` therefore sits near blue's ceiling while leaving green at a third of its own — a
palette that is simultaneously over- and under-saturated. The fix is **relative chroma** (`relC`):
express chroma as a fraction of the cusp at that L/H, so every hue is equally saturated _in
appearance_. Note also that the wide-gamut win is hue-dependent — P3 buys +36% for green and only
+9% for blue.

Two further rules from the same source, both of which bit us:

- **"Reduce chroma, not lightness or hue"** when gamut-mapping. Clipping RGB channels shifts hue.
- **"CSS auto-maps; JS doesn't — `oklch→hex` just truncates channels."** Our entire measurement
  pipeline converted OKLCH→hex in JS. We tested it: every value we generated happened to be in
  gamut, so nothing was corrupted — but the harness was one out-of-gamut value away from silently
  measuring hue-shifted colours.

### 2.5 Halation: dark mode wants _less_ contrast, not more

Light text on a dark ground blooms on the retina (worse for astigmatic and myopic readers), and the
bloom scales with **both** luminance contrast and chroma. The counter-intuitive consequence is that a
dark palette should be _dimmer and less saturated_ than its light counterpart. Font weight is a minor
contributor, not the differentiator — an early attempt that bumped dark-mode weight to 600 was
correctly called out as "too heavy". Our grounds now differ in relative chroma (0.55 dark vs 0.80
light) and in lightness band, with only a 400/500 weight delta.

### 2.6 RYB / artist colour wheels: investigated, rejected, with reasons

[RYBitten][rybitten] implements Johannes Itten's chromatic circle via trilinear interpolation through
an 8-corner RYB cube. We mapped its wheel into OKLCH to see whether artist-wheel spacing serves us
better than perceptual spacing. Equal 30° steps on Itten's wheel produce OKLCH advances ranging from
**11° to 48°** — a 4.4× variation. It compresses red–orange–yellow and expands blue–purple.

That allocation runs **opposite** to what a screen palette needs: it spends the most wheel on blue,
which has the _lowest_ chroma ceiling of any region. Both RYB-even and OKLCH-even spacing yield only
8 distinct names for 9 categories; they simply collide differently (OKLCH doubles up on blue, RYB on
yellow). The library's own author is explicit that the traditional wheel "massively misrepresents
distances" and calls Moses Harris's equal-120° RYB "the origin of bad colour theory". RYB is a model
of pigment mixing; our problem is emissive-display discrimination. **Not adopted** — but the
investigation produced the name-region and chroma-ceiling measurements we now rely on.

---

## Part 3 — The hard result: dichromacy caps the palette at ~4 colours

The most important finding, and the one no amount of tuning removes. A greedy search over the whole
(hue × lightness) space on the dark ground, measuring CIEDE2000 under simulation:

| ΔE floor | max colours (normal vision) | max colours (deuteranopia) |
| -------- | --------------------------- | -------------------------- |
| 17       | **13**                      | **4**                      |
| 15       | 14                          | 5                          |
| 12       | 20                          | 6                          |
| 10       | 26                          | 8                          |
| 8        | —                           | 10                         |

**Deuteranopia collapses the available palette by roughly 3×.** Nine categories are comfortably
feasible for normal vision and _structurally impossible_ under dichromacy by colour alone: at n=9 the
best attainable deutan floor is about **ΔE 8–10**, against the 17 that normal vision supports.

This is a property of human vision, not a defect in the optimiser — and it is why Petroff's 10-colour
sequence relaxes to ΔE 16 and includes near-greys, and why the colour-expert notes insist greyscale
is "a quick sanity check for lightness separation, not an accessibility proof".

**Consequences we accept:**

1. Set the CVD floor to the measured ceiling (~8) rather than an aspirational number.
2. Carry the residual on a **non-colour channel** — per-category font weight or underline — which is
   deficiency-independent. This is not optional polish for the editor decorations, where colour is
   otherwise the only signal.
3. For the word-detail pills, shape and position already disambiguate, so colour alone is adequate
   there.

---

## Part 4 — What shipped: a hand-authored construction

**The optimiser lost.** After the search described above produced a palette that was measurably
strong and visually monotone, the author built one by hand in Figma (via
[Harmonizer](https://harmonizer.evilmartians.com/)) that beats it on every metric that matters:

| separation, as a deuteranope sees it | authored | best optimised |
| ------------------------------------ | -------- | -------------- |
| `noun ↔ verb`                        | **29.4** | ~8             |
| `particle ↔ noun`                    | **36.9** | ~9             |
| APCA spread across the palette       | **0.8**  | 4–17           |

### The construction

**Two orthogonal semantic axes.** Four clusters at 45° / 135° / 225° / 315° — both axes exactly
180° opposed (measured, not approximated):

```
                actions (45°)
                     │
 structure (135°) ───┼─── modifier (315°)
                     │
                things (225°)
```

**Each 90° quadrant is divided into N equal sub-slots, one member centred in each.** Same rule
throughout, different N:

- 2 members → 45° slots → centres at ±22.5° → things at 202.5° / 247.5°
- 3 members → 30° slots → centres at −30/0/+30 → modifiers at 285° / 315° / 345°

The six two-member-cluster hues land on **odd multiples of 22.5° (= 360/16)** — a perfect 45°
cadence, which is _why_ every cross-axis pair is near-complementary rather than approximately so.
The three modifiers deliberately break the cadence, compressing into an arc sized for two; that is
the right trade, because the modifier cluster is the rarest by a wide margin (1.38 + 1.51 + 1.81 =
4.7% of tokens).

**Uniform APCA, not uniform lightness.** Every colour sits at Lc 70.2–71.5. Lightness _varies_
slightly (0.842–0.862) precisely so that perceived contrast does not. The optimiser held lightness
constant and let contrast drift — backwards, since contrast is what a reader perceives.

**Chroma pinned to the most constrained hue**: a single flat value per ground (0.08 dark, 0.12
light), with several hues sitting exactly at their gamut ceiling. No hue is over-saturated relative
to its neighbours, so no word out-shouts another in running text.

### Utterance is structure

Verified against 25,000 sentences before adopting it. Utterance-class words (`感動詞`/`フィラー`/
`接続詞`) are **sentence-initial 38.0%** of the time and medial 57.8%; particles are
**sentence-initial 0.0%** and medial 97.3%. Neither ends a sentence (4.2% / 2.7%). Both divide and
frame — they simply do it at different scales — so they share a cluster and sit 44° apart in it.
This is what reduced five clusters to four and made the two-axis scheme possible.

### The CVD variants use the same construction

Under dichromacy the hue circle collapses onto one axis, so the quadrants are re-projected rather
than abandoned. Surviving axes, found by locating the widest perceived hue pair under each
simulation: **protan 90°↔285°, deutan 90°↔270°, tritan 15°↔225°**.

- **Clusters** separate by hue, spread along that axis (ΔE ~6–9 each).
- **Members** separate by lightness (a 0.12 step gives ΔE ~9.6).

Neither channel suffices alone; in OKLab they are additive. The rung _assignment_ — which category
takes which lightness — is searched, because nine categories over four clusters has too many
interactions to assign by hand (two manual attempts collapsed to ΔE 0.5 and 2.2). The _structure_
is never searched. Result: ΔE-as-seen of 10.5 / 10.1 / 8.8 on light grounds, competitive with an
unconstrained optimiser while keeping the semantics intact.

### Errors worth recording

Each produced plausible-looking output and was caught only by measuring or by eye:

- **Optimising ΔE alone** → the monotone palette: nine hues collapsed into a 95° arc, two categories
  1° apart, circular hue variance 0.431 against 0.82–0.94 for every hand-built candidate (§2.1).
- **Penalties instead of structure.** Three separate times a property survived only once it was
  encoded in the _search space_ rather than the loss function: name diversity (collapsed to 7/9 until
  bands were locked), hue collisions (until placement became one monotone walk), family contiguity
  (until quadrants became contiguous by construction). A penalty is a preference the optimiser can
  outbid; structure is a guarantee.
- **Soft lightness penalty** → the optimiser bought separation with L=1.013, whiter than white.
- **Two independent hue formulas** → adverb landed 3° from auxiliary; a later revision put particle
  _exactly_ on adjective (ΔE 0.00).
- **Solving the two grounds independently** → unrelated hue assignments (noun at 126° dark, 342°
  light), which would read as two different palettes on theme switch.
- **Chroma, wrong in both directions.** Relative-to-cusp (`relC` 0.62) gave a 2.1× spread — particle
  at C 0.132 shouting while adverb at 0.063 whispered. Then one flat absolute value dragged every hue
  down to what teal could carry, muddying the whole palette. The authored answer is neither: a target
  capped at each hue's own ceiling.
- **Hex as the source of truth.** `toHex` was feeding APCA, CVD simulation and the stored palette —
  quantising to 8 bits _and_ clamping wide-gamut values. Six of the authored palette's eighteen
  colours sit outside sRGB deliberately, so reading them back from hex silently pulled them in and
  made a flat chroma of 0.08 measure as an uneven 0.075–0.081. **OKLCH is the source; `rgb()` is the
  fallback; hex is a last resort.**

---

## The documents

| file                                                     | what it is                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pos-palettes.md`](pos-palettes.md)                     | **The deliverable.** Four palettes × two grounds, rendered unsimulated, with side-by-side comparison groups sized for screenshots. This is what goes to reviewers.      |
| [`pos-palettes-review.md`](pos-palettes-review.md)       | The standard palette under the three dichromacy simulations, for a **normally-sighted** reviewer to judge how far it degrades.                                          |
| [`pos-palette-editor.html`](pos-palette-editor.html)     | Interactive editor: hue on the angle, lightness on the radius, four semantic quadrants that rotate together. Opens in a browser; emits `oklch()` plus `rgb()` fallback. |
| [`pos-palette-comparison.md`](pos-palette-comparison.md) | **Superseded.** The record of the optimiser search — kept because the failures are instructive.                                                                         |

**Why two review surfaces.** Showing a CVD reader a _simulation_ asks them to validate our model of
their vision, which they cannot do from the inside. The deliverable shows the palette built for them,
unsimulated, and asks the only question they can answer: does this separate words better?

A simulation is also a **worst case** — it models _dichromacy_ (a cone type absent), while the more
common condition is _anomalous trichromacy_ (a cone type shifted), where more differentiation
survives.

## Reproducing

Everything is derived, not hand-tuned, except the authored palette itself. Generators live in the
session scratchpad:

| file                       | what it does                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `color-core.mjs`           | OKLCH primitives, gamut cusp, CVD simulation, CIEDE2000, APCA. **`oklch()` is the source; `toRgbFallback` and `toHex` are fallbacks only.** |
| `authored.mjs`             | the authored palette's exact `oklch()` values and the quadrant construction                                                                 |
| `cvd-quadrants.mjs`        | re-projects the construction onto each CVD axis; writes `palette-cvd.json`                                                                  |
| `gen-palettes.mjs`         | renders `pos-palettes.md` and `pos-palettes-review.md`                                                                                      |
| `adjacency.json`           | 672,371 measured category transitions                                                                                                       |
| `optimize2.mjs`, `gen.mjs` | the superseded optimiser and its comparison doc                                                                                             |

Colour maths uses [colorjs.io](https://colorjs.io), verified against published reference values
(OKLCH red = L 0.628 C 0.258 H 29.2; APCA black-on-white = 106.0). CVD simulation is the
Brettel–Viénot–Mollon linear-RGB projection, which colorjs does not ship.

---

## References

[colorgorical]: https://vis.cs.brown.edu/docs/pdf/Gramazio-2016-CCD.pdf
[reda]: https://onlinelibrary.wiley.com/doi/abs/10.1111/cgf.14288
[revisiting]: https://arxiv.org/abs/2404.03787
[petroff]: https://arxiv.org/abs/2107.02270
[strom]: https://mattstromawn.com/writing/how-to-pick-the-least-wrong-colors/
[colorexpert]: https://github.com/meodai/skill.color-expert
[rybitten]: https://github.com/meodai/RYBitten
[bk]: https://www.pnas.org/doi/10.1073/pnas.1532837100

- Gramazio, Laidlaw & Schloss (2017). _Colorgorical: Creating discriminable and preferable color
  palettes for information visualization._ IEEE TVCG 23(1). — [PDF][colorgorical]
- Reda, Nalawade & Ansah-Koi (2021). _Color Nameability Predicts Inference Accuracy in Spatial
  Visualizations._ Computer Graphics Forum 40(3). — [link][reda]
- _Revisiting Categorical Color Perception in Scatterplots: Sequential, Diverging, and Categorical
  Palettes_ (2024). — [arXiv:2404.03787][revisiting]
- Petroff (2021). _Accessible Color Sequences for Data Visualization._ —
  [arXiv:2107.02270][petroff] · [code](https://github.com/mpetroff/accessible-color-cycles)
- Ström. _How to pick the least wrong colors._ — [essay][strom] ·
  [code](https://github.com/ilikescience/category-colors)
- Aerne (meodai). _Colour-expert notes_ — [skill.color-expert][colorexpert]; _RYBitten_ —
  [RYBitten][rybitten]; _color-names_ — [dataset](https://github.com/meodai/color-names)
- Wijffelaars, Vliegen, van Wijk & van der Linden (2008). _Generating Color Palettes using Intuitive
  Parameters._ Computer Graphics Forum 27(3).
- Regier, Kay & Cook (2005). _Focal colors are universal after all._ — [PNAS][bk]
- Ottosson (2020). _A perceptual color space for image processing (Oklab)._ —
  [article](https://bottosson.github.io/posts/oklab/)
- Levien (2021). _An interactive review of Oklab._ —
  [article](https://raphlinus.github.io/color/2021/01/18/oklab-critique.html)
- Locke. _Why dark mode causes more accessibility issues than it solves_ (halation). —
  [article](https://medium.com/@h_locke/why-dark-mode-causes-more-accessibility-issues-than-it-solves-54cddf6466f5)
- NINJAL. _Balanced Corpus of Contemporary Written Japanese (BCCWJ)._ —
  [frequency lists](https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html). Searched for per-register POS
  distributions and POS bigram matrices; NINJAL publishes word-frequency lists but not these tables,
  which is why §1.2–1.3 measure our own corpus directly.
