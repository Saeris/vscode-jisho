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

## 3. Evaluation harness — as built (2026-07-25)

A **thorough-but-not-exhaustive** accuracy gate, so reading everyday Japanese has a low false-positive resolution rate. Curated seed (~30 sentences / 47 pinned words), hand-judged; frozen-regressions hard-fail + per-register precision floored at a recorded baseline (the agreed gate design).

**Methodology — hand-judged gold, not mechanical labels.** Every expectation in `src/host/__tests__/accuracy/gold.ts` was read, segmented, and translated by hand: the gold is _correct linguistic understanding of the sentence_, not the code's output and not a blindly-trusted label. A word is only a hard expectation when its resolution is DECIDABLE in context; genuinely-ambiguous or absent-from-DB words are marked `optional` (reported, never gate). Each non-obvious word carries a `note` with the reasoning.

**Wiring.** The scorer (`accuracy/score.ts`) drives the REAL pipeline — it does not re-implement resolution: `segment(sentence)` → for each gold word, the segment carrying it → `resolveByLemma(lemma, pos, reading)`, exactly what a hover does. `accuracy.spec.ts` runs it against the built `assets/jisho.db` (skips when absent, like `db.spec.ts`; opens a per-spec DB copy to dodge Turso's Windows file-lock against `db.spec`).

**What the first run found (the harness earned its keep).** Measured 0.739 precision cold, and the misses split into three kinds, each hand-judged:

- **A genuine CODE bug — reading discarded.** `本` (read ほん, "book") resolved to `元` (もと); `風`→`振り`; `息`→`息子`. Root cause probed: `本` is a kanji WRITING shared by two entries (本/ほん and 元/もと), and `resolveByLemma` ranked by frequency alone (元 freq 5 beat 本 freq null), ignoring the reading the tokenizer already knew. **Fix**: `resolveByLemma` now takes the tokenizer's reading and a reading-match tier that dominates frequency (§ below). This is the okurigana/reading-narrowing the diagnosis predicted, one layer up from 為る's "backwards freq_rank". Covered by `db.spec.ts` ("disambiguates a homograph by the tokenizer's reading").
- **Gold errors (my corpus, corrected).** `いい`'s correct entry surfaces as kana いい (not 良い); 何してる folds into one 何する segment in the tokenizer, so the して→する regression uses 宿題をしてる to isolate してる.
- **Non-defects, documented as `optional`.** 揺らす / 下人 are ABSENT from the shipped JMdict build (null is correct); お送り keeps the honorific お in the tokenizer lemma (a tokenizer-layer gap, not a `resolveByLemma` bug — 送る is in the DB).

**Reading-disambiguation fix (as built).** `resolveByLemma(lemma, pos, reading?)` — when the tokenizer supplies a reading, an entry whose kana matches it outranks one that merely shares the kanji writing but reads differently. Reading (katakana ホン) is folded to hiragana (`toHiragana`, now exported from `shared/ruby.ts`) before comparing. The hover threads the group head's reading through (`hoverProvider.ts`). General, not a three-word patch: any homographic content word (本/元, 風/振り, 息/息子, 家 いえ/か, …) now resolves by what was actually read.

**Result**: 47 pinned words → 1.000 precision on the 43 decidable ones, every register, zero regression failures; the 4 remaining misses are the documented `optional` cases above. `PRECISION_FLOOR` is set one word below measured per register — a benign upstream shift won't flake, a second wrong resolution in any register trips the gate.

**Growing it**: the corpus is deliberately compact and curated, not exhaustive; add sentences (Aozora Bunko formal prose, more casual/slang) and RAISE the floors as coverage grows. Never lower them.

## 4. Usually-kana headword display — as built (2026-07-25)

A second round of live-hover screenshots (post reading-fix) showed the RESOLUTION was now right but the HEADING was confusing: `uk` (usually-kana) words displayed their archaic kanji — 此処 for ここ, 一寸 for ちょっと, 有難う for ありがとう, 為る for する. The entry was correct; the written form shown was not the one anyone uses.

Fix in `#searchResult` (db.ts), so it corrects BOTH the hover heading and search-result headings at the source: show the KANA as headword when the word is `uk` **and** its primary kanji writing is not `is_common`. The compound condition matters — `uk` alone is too blunt: 美味しい / 犬 / 来る / 置く are all tagged `uk` yet routinely written in their (common) kanji, so gating on an _uncommon_ kanji writing keeps their kanji heading while flipping only the genuinely-archaic ones. When the kana is the heading, the separate reading line is dropped (the kana reads itself; `rubyHeading` already collapses reading==headword).

The same screenshots also confirmed the reading-fix (§3) landed: うん in `うん、いいよ` now resolves to the interjection うん ("yeah"), not 運 ("luck") — the noun 運 no longer wins on frequency once the kana-only interjection matches the reading. Locked as a named regression in the corpus (`うん、いいよ`), plus casual gold for the `uk` headings (ここ, ちょっと, ありがとう, する).

## 5. Sense-breadth tiebreaker — as built (2026-07-26)

A broader corpus sweep (casual/slang, contractions, homophone-prone kango) found one more resolution false-positive class that neither reading, kanji, POS, nor `uk` separates: **two entries sharing a kana reading, where `freq_rank` picks the wrong one.** なる resolved to 生る ("bear fruit", 1 sense, freq_rank 7) over 成る ("become", 11 senses, freq_rank 34) — because `freq_rank` scores the KANJI CHARACTER's newspaper frequency (生 is ubiquitous: 生きる, 学生, 生まれる…), NOT the word's. Both are `uk`, both v5r, both read なる, both `ichi1`/`news` priority — so every tier above frequency was level and freq_rank led astray.

Priority tags don't help (生る is even `news1` to 成る's `news2`). The robust discriminator is **sense breadth**: JMdict lexicographers pile senses onto the workhorse word (成る 11, する/為る 17, 来る 5) and leave the niche homophone single-sense (生る 1). `resolveByLemma` now adds a capped sense-count tier (`min(sense_count, 12) * 8`) ABOVE frequency — the same "many-sensed = everyday word" reasoning `search()` already uses for gloss breadth, applied at entry level. Verified all prior wins hold (する/本/元/ここ/来る/勉強 unchanged); locked as a named regression (`彼は医者になりたい`) and a `db.spec` case (なる→成る "become").

**Still open (noted, not fixed — tokenizer-layer, out of `resolveByLemma`'s reach):** slang shattered by the dictionary (きもい → き/い虫), contractions (そっか → そっ), honorific-prefixed lemmas (お送り), and a wrong-lemma pick (雨が降り**そう** read as 降りる "descend" not 降る "fall"). These are IPADIC/segmentation gaps, tracked for a future tokenizer pass, not resolution bugs.

## Verification

- Unit: `pos.spec.ts` (POS compatibility); `db.spec.ts` `resolveByLemma` cases incl. the reading-disambiguation regression (本→本, not 元).
- E2E: the hover resolves する→"to do" (POS-aware), no regression on 食べる/particle hovers.
- Harness: `accuracy.spec.ts` — per-register precision against the hand-judged gold; frozen regressions hard-fail.
