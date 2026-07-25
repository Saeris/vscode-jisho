# Spec 12 — Editor matching accuracy: POS-aware resolution, typed deinflection, and an evaluation harness

**Backlog:** #43 (+ #42). **Status:** the **primary fix is IMPLEMENTED** (POS-aware hover resolution); the deinflection rewrite and the evaluation harness are specified here and pending. This spec records the diagnosis (evidence-based, not assumed) so it isn't re-derived.

## The problem

Hovering everyday Japanese — casual/colloquial words, kana-only words, kango whose meaning shifts with context — surfaced the wrong dictionary entry. Reported examples: `あー、いいよ` matching over-complex kanji; `し`/`して` resolving to 死ぬ / 死 instead of する; and the noun 勉強 vs the verb 勉強する not being distinguished. Distinct from search _ranking_ (BACKLOG #1) — this is the tokenizer→dictionary **resolution** used by the editor hover.

## Diagnosis (probed against the real code, 2026-07-25 — do not re-derive)

**The Lindera tokenizer is already CORRECT on the hard cases.** Probing `segment()` directly:

| Input                | Tokenizer output                             | Verdict                 |
| -------------------- | -------------------------------------------- | ----------------------- |
| `いいよ`             | いい (adjective, lemma=いい) + よ (particle) | ✓                       |
| `して`               | し (verb, **lemma=する**) + て (particle)    | ✓ — not 死ぬ            |
| `勉強する` vs `勉強` | 勉強する (verb, lemma=勉強) vs 勉強 (noun)   | ✓ context-disambiguated |
| `あー、いいよ`       | あー + 、 + いい (adj) + よ (particle)       | ✓                       |

The whole-sentence Viterbi already does the context-sensitive segmentation the problem seemed to need. **The failure was DOWNSTREAM.** `resolveWord` (hover.ts) took the tokenizer's correct lemma but passed only the lemma STRING to `search()`, discarding the known POS. `search()` then re-ranked by frequency, re-introducing homophone ambiguity (probed):

- `search("する")` → **擦る [to rub]** first (為る/する second) — 為る is _usually written kana_, so its kanji form was never frequency-ranked; **freq_rank is backwards** for such words.
- `search("し")` → **死 [death]** first.

The example linkifier (F1-links) gets these RIGHT because it resolves lemma→entry directly and never round-trips through ranking — that is the model to copy.

The disambiguating signal is already in our data (probed `為る` vs `擦る`):

| Entry         | freq_rank | misc                | kana する common? | kanji common? |
| ------------- | --------- | ------------------- | ----------------- | ------------- |
| 為る (to do)  | null      | `uk` (usually-kana) | yes               | 為る: no      |
| 擦る (to rub) | 36        | —                   | yes               | 擦る: yes     |

So for a KANA lemma, the entry normally _written_ in kana (`uk`, or no common kanji form) is the right one — 為る, not 擦る.

## 1. POS-aware resolution — as built (2026-07-25)

- **`src/shared/pos.ts`** — `posMatches(coarse, jmdictCode)` / `anyPosMatches` bridge the tokenizer's coarse POS (verb/noun/…) to JMdict's fine codes (v1, v5r, adj-i, n-suf…), permissive within a category but rejecting cross-category (a noun code never satisfies "verb"). `asPartOfSpeech` narrows a raw tokenizer string. Unit-tested.
- **`Dictionary.resolveByLemma(lemma, pos)`** (db.ts) — resolves a tokenizer (lemma, POS) to the single best entry. Ranking, each tier dominating the next: (1) exact kanji-writing match when the lemma has kanji, (2) POS-compatible senses, (3) for a kana lemma, `uk`/no-common-kanji entries (floats 為る above 擦る), (4) frequency, (5) common. Returns null when nothing matches (caller falls back to `search`).
- **Hover** (hoverProvider.ts) — for a content word the tokenizer categorized, calls `resolveByLemma(lemma, tokenizerPOS)` instead of `search(lookup, 1)`; falls back to `search` only for `other`/uncategorized runs.
- **Verified**: `resolveByLemma` unit tests (する→"to do", 勉強→noun, いい→adj, 食べる→exact-kanji, unknown→null) and a live hover E2E (hovering する in 仕事をして… shows "to do", explicitly NOT "to rub"/"death").

## 2. Typed deinflection — as built (2026-07-25)

`deinflect()` was over-generating with NO POS constraint. **Measured** (before): `search("して")` → 仕手 | 知る | 汁 | 擦る | 為る (為る 5th); `search("きます")` → 切る | 着る | 来る (来る 3rd). The garbage buried the intended verb.

Rewritten (src/host/deinflect.ts) on **Yomitan's typed-transform model** (studied, not copied):

- Each rule carries `conditionsIn`/`conditionsOut` — a form's ending rewrites only when the current state matches, chaining through intermediate conditions (`-ます`, `-て`, `-た`, `-ない`, `-ば`) to a dictionary-form condition (`v1`/`v5`/`vk`/`vs`/`vz`/`adj-i`).
- `deinflectCandidates(query)` returns `{ term, conditions }[]` — each candidate TAGGED with its verb CLASS. `deinflect(query)` keeps the old bare-string contract.
- **`candidateMatchesPos` validates the specific verb CLASS**, not coarse "is a verb". This is the load-bearing fix: して deinflected as a v1 (ichidan) te-form is rejected against 知る (a v5r godan verb — 知る's te-form is しって, not して), so して resolves to する (vs) alone. Coarse POS would wrongly accept 知る.
- **サ変**: a する-verb's JMdict dictionary form is the stem NOUN (勉強, a vs sense), not 勉強する — so a vs candidate ending in する also emits the base noun (勉強しました → 勉強).
- **Kanji-written irregulars** (来た/来て/来ます) get whole-word entries (the kana rules key on きた, and the generic rules would tag 来た as v1, mismatching 来る's vk).
- `search()` (db.ts) consumes the tagged candidates and only merges a deinflection when the entry's `senses.pos_json` matches the candidate's class. Tokenizer `extraLemmas` bypass validation (already the right word).

**Result** (measured after): `search("して")` → 仕手 | **為る** | … (為る 2nd, 知る/汁/擦る gone); `search("勉強した")` → 勉強; `search("来た")` → 来る. Genuine ambiguity (きます from 来る/着る, both valid verbs) is preserved and frequency-broken, by design.

**Verified**: `deinflect.spec.ts` (class tags, class rejection, サ変 base, kanji irregulars), `db.spec.ts` (して rejects 知る; 勉強した→勉強; 来た→来る), and the `conjugate.spec.ts` round-trip (every UI-displayable conjugation deinflects back — it caught the one gap, the godan さ-causative 話させる→話す).

**Out of scope (noted, not fixed):** when a conjugated form's kana EXACTLY equals a common noun's reading (した = 舌/下 vs past-of-する; して = 仕手), the exact-homophone noun can rank above the deinflected verb. That is genuine ambiguity out of context and a search-_ranking_ question, not a deinflection bug.

## 3. Evaluation harness (pending)

A **thorough-but-not-exhaustive** accuracy evaluation, so reading everyday Japanese has a low false-positive resolution rate, runnable as a gate.

**Methodology — hand-judged gold, not just mechanical labels.** The reviewer (human OR the implementing agent) reads each sentence, segments and translates it with their own comprehension, and compares that judgement to what the code produces — actively discerning where the code misses subtlety or resolves the wrong entry, at the same level of scrutiny a fluent reviewer designing these tests would apply. The gold standard is _correct linguistic understanding of the sentence_, not the code's own output and not a blindly-trusted external label. Mechanical labels (e.g. a pre-tagged corpus) seed and cross-check, but the judgement call on "is this the right entry for this word in this sentence" is made by comprehension.

- **Corpus**: everyday Japanese spanning registers (casual ↔ formal) and lengths (short ↔ long), incl. casual/slang. Seed from Tatoeba (already shipped) and public-domain / free-to-use text (e.g. Aozora Bunko for formal prose; verify licences before bundling). Keep it curated and representative, not exhaustive.
- **Metric**: precision of hover/tokenizer→entry resolution — the fraction of content words whose resolved entry is the correct one for that sentence. Track false-positive resolutions specifically (the reported failure mode). Report per-register so casual-text regressions are visible.
- **Seed regression cases** (already fixed, must stay fixed): する→為る (not 擦る/死), 勉強 (noun) vs 勉強する (verb), いい→いい (adjective), あー、いいよ segmentation.
- **Gate**: run in CI against the built DB; a precision drop fails the build. Design the corpus format + scorer, get sign-off, then populate.

## Verification

- Unit: `pos.spec.ts` (POS compatibility), `db.spec.ts` `resolveByLemma` cases.
- E2E: the hover resolves する→"to do" (POS-aware), no regression on 食べる/particle hovers.
- Harness: precision measured per-register against the hand-judged gold corpus; the seed regressions stay green.
