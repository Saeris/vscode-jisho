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

## Remaining: the UI (F1-UI)

- A dedicated **"more examples" surface** per word (the deferred #20c): a scrollable view rendering the pool with furigana, sense-attributed sentences grouped under their sense and the word-level pool below. Reached from the inline `Examples` "Show all".
- New host read (e.g. `getMoreExamples(wordId)`) returning the `source='tatoeba'` rows with `ja_furigana`; a new webview view + navigation-machine entry (the machine was designed to grow views).
- The inline furigana is stored too — the inline renderer can start showing ruby once it parses `{漢字|かんじ}` markup (currently plain text); do this with the UI pass.

## Attribution

Tatoeba is **CC BY 2.0 FR** (already cited for the Tanaka examples). Extended in README, About, and `meta` (`sentenceSource`, `tatoebaPoolRows`, the three export dates) for the fuller corpus.

## Verification

- Build: pool populated, `SUM(source='tatoeba') > SUM(source='tanaka')`, 0 rows where one Tatoeba id is both sources for a word, 0 rows with empty `ja_furigana`. (Pinned in `db.spec.ts` — "stores the Tatoeba example pool separately from the inline set".)
- UI: a sense shows its inline example; the "more examples" surface renders sense-grouped + word-level pool with furigana and navigates.
- Full-scale (measured 2026-07-24): the full build is 217,974 words, **32,031 inline + 157,261 pool** rows, 10m34s, no OOM at an 8 GiB heap. The pool grows sub-linearly (capped 20/word), so it is ~1.35× the common build's pool, not 10×. 0 dedup violations, 0 empty furigana at full scale. Search latency over the larger sentence set is still tracked separately (the full-scale latency pass).
