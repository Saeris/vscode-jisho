# Spec 09 — Richer example sentences: full Tatoeba pool + build-time furigana

**Backlog:** #20 (two-tier examples) + the #32/#20 examples restructure. **Status:** **schema + build IMPLEMENTED** (the pool ships in the DB); the UI (the "more examples" surface) is the remaining piece, tracked with F1-UI. This is an as-built record for the build half and a spec for the UI half.

## Objective

Word detail shows too few example sentences compared with Jisho.org. The inline per-sense examples come from `jmdict-examples-eng`, which embeds only the curated **Tanaka-corpus subset** of Tatoeba (~1 sentence/sense). Import the **fuller Tatoeba corpus** to back a word-level "more examples" surface, on top of — not replacing — the accurate inline set, with furigana on every stored sentence.

## The finding that shaped this (do not re-research)

**Per-sense example depth is capped UPSTREAM, not by us.** JMdict carries the sentence↔sense link via Jim Breen's `<ex_srce>` elements _inside each `<sense>`_; our `sentences` table already stores that per sense. But the linked set is only the Tanaka subset — measured on the built common DB, of senses with any example, **16,717 have exactly 1**, only 281 have 2–3. Raising the per-sense cap does nothing; the extra sentences Jisho shows are **word-level, unlinked** Tatoeba sentences with no sense attribution. So the honest maximum is: keep the accurate per-sense inline example, add a word-level pool.

## Decisions already made (do not relitigate)

1. **Inline stays Tanaka, pool is Tatoeba.** The per-sense inline example remains the curated Tanaka sentence (`source='tanaka'`, sense-linked, accurate). The "more examples" pool is the fuller Tatoeba corpus (`source='tatoeba'`).
2. **Sense-aware where the data allows, word-level otherwise.** The Tatoeba jpn_indices B-line carries a `[NN]` sense tag on ~20% of tokens (measured: 19.9% of 1.18M tokens). Where it resolves in range, the pool sentence attaches to that sense; otherwise to the word-level bucket (`sense_position = -1`). Not a gloss-match heuristic — only the source's own sense tags.
3. **Up to 20 pool sentences per word**, spread across senses + the word-level bucket.
4. **Dedup by Tatoeba id** so a pool sentence never repeats the inline one shown for that same word.
5. **Build-time furigana on every stored sentence** (measured ~0.4 ms/sentence, ~1 min for the whole corpus). Store the `{漢字|かんじ}` ruby; zero runtime tokenizer cost.
6. **Source: Tatoeba weekly exports**, jpn-only, pinned by `last-modified`.

## As-built: the build (scripts/build-data.ts)

- **Downloads** (~31 MB total, bz2 via the build-only `unbzip2-stream` devDependency):
  - `jpn_indices.tar.bz2` — `sentence_id ⇥ meaning_id ⇥ B-line`. The B-line lists head-word tokens: `headword(reading)[NN]{surface}~` (all but headword optional; `[NN]` = 1-based sense, `{surface}` = form in sentence, `~` = checked marker).
  - `per_language/jpn/jpn_sentences.tsv.bz2` — `id ⇥ jpn ⇥ text` (the Japanese sentence).
  - `per_language/eng/eng_sentences.tsv.bz2` — `id ⇥ eng ⇥ text`; the index's `meaning_id` IS an English sentence id (~98% resolve → the translation).
- **Resolution**: each B-line token → `words.id` via kanji+reading → kanji → reading (most specific first, the same match style as the priority join). `[NN]` in range → `sense_position = NN-1`, else `-1`.
- **Storage**: extends the existing `sentences` table with `ja_furigana`, `tatoeba_id`, `source`. Pool rows on a real sense start at `POOL_POSITION_BASE` (= `MAX_SENTENCES_PER_SENSE`) so they never collide with an inline row on the shared PK `(word_id, sense_position, position)`; the word-level bucket has no inline rows to avoid.
- **Verified on the common build**: 17,300 inline + 116,272 pool rows, 0 dedup violations, no PK collisions, furigana present on every row.

## As-built: the host (src/host/db.ts)

`getWord` scopes the inline read to `source='tanaka'` so the pool never leaks into the per-sense list (the ≤3-per-sense cap test now also guards this). The pool is dormant in the read path until the UI ships.

## The UI (F1-UI) — as built (2026-07-25)

- A dedicated **"more examples" page** per word (`MoreExamples.tsx` + a `moreExamples` nav-machine view): scrollable, sense-attributed sentences grouped under their sense's gloss, then the word-level pool. Reached from a word-level **"📖 More examples ›"** link on `WordDetail` (after the senses), styled like the kanji page's stroke-order/component-tree links. Shown unconditionally — the pool exists for nearly every word and the page degrades to "No additional examples" otherwise.
- Host read `getMoreExamples(id)` returns the `source='tatoeba'` rows with `ja_furigana`, grouping sense-tagged sentences and reading each sense's first gloss as the header. `getWord` still shows only the inline Tanaka set (unchanged).
- Furigana rendered via a shared `Ruby` component (extracted from `Term`). Sizing tuned after screenshot review: base kana `1.25em`, `<rt>` `0.55em` ON THIS PAGE (still ~9.6px, above the readable floor) — a larger base with a narrower reading fixed the awkward inter-character gaps that wide readings (せいはくまい over 精白米) forced at the shared 0.7em default.
- Tests: nav machine (open + back to the word), `getMoreExamples` (pool-only, furigana, sense-grouping, excludes Tanaka), Ruby rendering, WordDetail prop threading.

## Clickable example vocabulary (F1-links) — as built (2026-07-25)

A first attempt made the furigana groups tappable — REJECTED: build-time furigana only wraps kanji-bearing runs, so word boundaries were unclear and hit targets wrong. The shipped approach is **build-time linkification**:

- **Build** (`annotateExample` in `build-data.ts`): tokenize each example, and for each content word (noun/verb/adjective/adverb) resolve its lemma+reading to a JMdict `ent_seq` (= `words.id`) via the same word index the Tatoeba join uses, emitting markdown-link markup whose link SPAN is the FULL word (okurigana + conjugation, furigana nested inside), targeting `pos:entseq`. Particles/aux and unresolved runs stay plain text with any furigana. Measured on the common build: **99.97% of sentences carry ≥1 link**.
- **Format** (`src/shared/exampleLinks.ts`): the single source of truth shared by build (emit) and webview (parse) — `[word](poscode:entseq)`, POS as a short code, plus a `parseExampleMarkup` that splits a sentence into ordered link/text parts.
- **Webview** (`ExampleSentence.tsx`): parses the markup, renders link parts as tappable spans (quiet affordance — color + underline on hover/focus only, matching the headword tap-through) and text parts as furigana. **Tap opens the entry BY ID** — safe because the links and the DB are regenerated in the SAME build and ship together, so an id is never stale relative to the DB it lives in (users can't edit entries; D swaps the DB wholesale). Verified end-to-end (an E2E smoke test taps a word and lands on its detail).
- Incremental/diff DB regeneration is a real but separate want, NOT a blocker here (a full rebuild reproduces the same ent_seq ids).

Observed limitation: tokenizer segmentation isn't perfect (食べるよう merges the nominalizer, なったのです merges), so a few links have slightly-off boundaries — but each still lands on a useful entry; it's tokenizer granularity, not a linkification bug. Notably the example linkifier resolves words the hover mis-resolves (し→する, where the hover hits 死ぬ) — a data point recorded for the accuracy-harness work.

## Inline examples — done (2026-07-30)

The inline per-sense examples render through the same `ExampleSentence` as the pool page, so they now carry furigana and tap-through links too.

This was NOT merely a deferred nicety by the time it got done: leaving the inline renderer on a plain string turned into a visible defect the moment F1-links changed what the stored markup contains. `getWord` stripped ruby with `stripRubyText` and printed the result, so `[もっと](adv:1012620)[果物](n:1193060)を…` reached the word page verbatim. Two things let it through — worth recording, because both are shapes that recur:

- **A half-correct transform looks correct.** Stripping one of two markup layers leaves a string that still contains the sentence, so nothing downstream could tell the difference by inspection.
- **The test that covered it could not fail.** `db.spec` asserted the sentence "matches a Japanese character", which `[もっと](adv:1012620)` satisfies. The assertion was about the join being wired up, and it kept passing while the rendering broke underneath it.

`SentenceDto` and `PoolSentenceDto` were identical once the inline DTO carried markup, so they are one type. Plain text is now derived where it is actually needed rather than in the query layer: `exampleText()` in `exampleLinks.ts` strips BOTH layers, and the editor hover — whose markdown subset renders neither — is its one caller.

## Attribution

Tatoeba is **CC BY 2.0 FR** (already cited for the Tanaka examples). Extended in README, About, and `meta` (`sentenceSource`, `tatoebaPoolRows`, the three export dates) for the fuller corpus.

## Verification

- Build: pool populated, `SUM(source='tatoeba') > SUM(source='tanaka')`, 0 rows where one Tatoeba id is both sources for a word, 0 rows with empty `ja_furigana`. (Pinned in `db.spec.ts` — "stores the Tatoeba example pool separately from the inline set".)
- UI: a sense shows its inline example; the "more examples" surface renders sense-grouped + word-level pool with furigana and navigates.
- Full-scale (measured 2026-07-24): the full build is 217,974 words, **32,031 inline + 157,261 pool** rows, 10m34s, no OOM at an 8 GiB heap. The pool grows sub-linearly (capped 20/word), so it is ~1.35× the common build's pool, not 10×. 0 dedup violations, 0 empty furigana at full scale. Search latency over the larger sentence set is still tracked separately (the full-scale latency pass).
