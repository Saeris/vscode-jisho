# Spec 02 — Contextual grammar notes: particles, auxiliaries, conjugation forms

**Backlog:** #34. **Blocked on:** nothing — but this is a WRITING task as much as a coding one, and the user (a Japanese learner who teaches a course) reviews all content before it ships. Budget accordingly.

## Objective

Dictionary entries explain words; learners hovering は, を, or the pieces of 食べたくなかった need GRAMMAR explanations — what a construct does, when it's used. Today a particle hover falls through to a thin JMdict entry at best, and the conjugation breakdown line labels auxiliaries with one-worders ("want to", "past"). Ship a curated grammar-notes dataset surfaced in the hover and the conjugation table's tooltips.

## Hard constraint: originality

**Tae Kim's Guide to Japanese and Tofugu's grammar articles are the user's QUALITY BAR — and must never be sources.** Tae Kim is CC BY-NC-SA; Tofugu is plainly copyrighted. Write original explanations; use those references only as models of what a good explanation covers (nuance, register, when-you'd-actually-use-it). Do not paraphrase specific passages. The content is versioned in-repo as ours.

## What already exists (build on, don't duplicate)

- `AUX_GLOSS` in `src/host/hover.ts` — one-word auxiliary labels feeding the breakdown chain line (食べたくなかった = 食べる + 〜たい (want to) + …). Explicitly documented as "the seed of #34".
- `GLOSSARY` in `src/webview/components/Term.tsx` — on/kun/nanori definitions plus when-you'd-use-it hints for all 15 conjugation-form labels (the user praised these: "they bring a lot of clarity").
- The hover's `groupSegments` already isolates particle segments and auxiliary morphemes — identification is done; only content + rendering remain.

## Architecture

### 1. Data (`src/shared/grammar.ts` — shared: host hover + webview Term)

```ts
export interface GrammarNote {
  /** One line, ≤ ~80 chars — the hover/tooltip headline. */
  gist: string;
  /** 2–4 sentences: what it does, when it's used, register/nuance. Plain language. */
  detail: string;
  /** One canonical example using N5-level vocabulary. */
  example: { ja: string; en: string };
}
```

Three key spaces, three lookup maps (do NOT force one keying scheme):

- `PARTICLE_NOTES: Record<string, GrammarNote>` keyed by surface (は, が, を, に, で, へ, と, から, まで, も, の, や, か, ね, よ — the ~15 N5 particles for v1).
- `AUXILIARY_NOTES: Record<string, GrammarNote>` keyed by LEMMA, covering every key currently in `AUX_GLOSS` (た, ます, ない, たい, れる, られる, せる, させる, う, よう, まい, そう, らしい, です, だ, ん, ぬ, いる, ある, しまう, ちゃう, おく, くれる, もらう, あげる). `AUX_GLOSS` one-worders stay for the compact chain line; each should equal (or derive from) its note's shortest label — single source: move `AUX_GLOSS` into grammar.ts and re-export.
- `FORM_NOTES: Record<string, GrammarNote>` keyed by the conjugation-table form label ("Te-form", …). Migrate `GLOSSARY`'s conjugation entries here (gist = the current hint text, then extend with detail + example); `Term.tsx` keeps its non-grammar entries (On/Kun/Nanori) locally and merges `FORM_NOTES` gists for lookup. Term's tooltip can show gist + example; keep it visually small.

### 2. Hover integration (`src/extension.ts` hover())

- **Particle groups**: when the hovered group's head pos is `particle` and a note exists, the hover leads with the note (`**は** — <gist>`, then detail, then example ja/en) and appends the dictionary entry below only if the JMdict lookup returns something sensible (keep the existing search; it already ranks exact-first). No note → current behavior.
- **Auxiliary under cursor**: the breakdown chain line stays as-is; when the cursor's morpheme (from `wordAt` offset math against `group.parts`) is an auxiliary with a note, append one extra line: `〜たい — <gist>` with the example. Do not stack all auxiliaries' notes — only the one under the cursor.
- Pure-kana runs: particles ARE pure-kana runs when standalone (the は in `これは`), but the hover only tokenizes kanji-bearing runs. Extend: if the run is a SINGLE character that has a particle note, show the note without tokenizing (safe: no segmentation involved). Longer pure-kana runs keep the existing whole-run-search behavior.

### 3. Content (the bulk of the work)

Voice and format rules — match the existing Term hints the user praised:

- Learner-directed, plain terms, no linguistics jargon without a gloss ("the topic marker — 'as for…'").
- Gist ≤ ~80 chars; detail 2–4 sentences; example sentences use N5 vocabulary the dictionary can resolve (tap-through friendly).
- No romaji. Kana/kanji as normally written; keep examples short enough for a hover.
- は vs が deserves cross-references in both details (the single most-asked question); に vs で likewise.
- **Definition of done includes user review of every note.** Ship the dataset in one reviewable commit (or PR-sized chunks by category) so the user can red-pen it.

## Test plan (behavior-first)

- **Completeness invariants** (unit): every `AUX_GLOSS` key has an `AUXILIARY_NOTES` entry; every conjugation-form label produced by `conjugate()` (all row `form` strings across a verb + both adjective tables) has a `FORM_NOTES` entry; every note's example.ja is non-empty and contains its own key (particle notes contain the particle, etc. — loose sanity, not strict).
- **Hover behavior** (unit on pure pieces + smoke E2E): hovering を in a real editor line (`写真を見せました`, cursor on を) shows "を" + gist text; hovering たく in `食べたくなかった` appends the たい note line. Extend the existing smoke hover test rather than adding launches.
- **Term tooltip**: component test — hovering "Te-form" now shows gist AND example (extend the existing Term/WordDetail specs).

## Verification loop

`vp check` → `vp test --run` → `vp pack` → `vp exec playwright test smoke.e2e.ts` → bump file (user-facing: "hovering a particle now explains its grammar…") → commit → **request user content review**.

## Out of scope

Grammar reference pages/views (#34 surface 3); sentence-level pattern detection (〜てしまう spanning conjugation chains is covered via the auxiliary note for しまう, not via pattern matching); N4+ particles and compound particles (について, として — later data additions); linting integration (#37 consumes the same notes later).
