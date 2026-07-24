# Spec 10 — Similar (look-alike) kanji, and the Yencken confusion-data roadmap

**Backlog:** new. **Status:** **data + host IMPLEMENTED** (the `similar` list ships in `KanjiDetailDto`); the kanji-page UI section is the remaining near-term piece (F3-UI). The four follow-on features are decided-to-pursue but UNSCHEDULED (also tracked in BACKLOG.md).

## Objective

The kanji page shows components and containing words but nothing about which kanji **look alike** — the ones learners actually confuse (未/末, 大/太/犬, 士/土, 日/白). Add a ranked "similar kanji" list, tappable to navigate between kanji pages.

## The corrected premise (why the plan changed)

The release plan specified a **weighted Kradfile-component heuristic**, on the belief that "no redistributable similar-kanji dataset exists (WaniKani's is proprietary)." **That premise was wrong**, and the heuristic proved inadequate anyway — measured on the build it:

- **misses atomic confusables** (大/太/犬, 日/白, 士/土 → nothing: they have no sub-components for overlap to work on), and
- **is noisy on compounds** (時→埒/涅/捏, 線→緲/緗/緝 — obscure kanji sharing a common radical, not confusable).

A redistributable dataset DOES exist: **Lars Yencken's kanji-confusion data** (https://lars.yencken.org/datasets/kanji-confusion/, **CC BY 3.0**), from his PhD research on which kanji people actually confuse.

## Decisions already made (do not relitigate)

1. **Primary source: Yencken, blended.** Fetch his stroke-edit-distance and Yeh-Li radical-distance tables (each: `pivot n1 score1 n2 score2 …`, 10 neighbours, score ∈ [0,1] higher = more similar, over the 1,945 jōyō kanji). **Blend** them (average a neighbour's score across the two tables), rank, keep top 6.
2. **Component heuristic as fallback**, only for the non-jōyō kanji Yencken doesn't cover.
3. **Blend of BOTH Yencken tables**, not stroke-edit alone — stroke-edit catches "differs by a stroke", radical distance catches "same radical, different phonetic"; together they model both axes of confusion.
4. **Precomputed** into a `similar_kanji(literal, similar, position)` table so the runtime read is a plain ranked lookup (like the sentence pool).

## As-built (scripts/build-data.ts, schema.sql, db.ts)

- `blendYencken()` averages the two tables' neighbour scores; `computeSimilarKanji()` is the component-heuristic fallback (IDF-weighted Jaccard × part-count closeness × stroke-count closeness, with a min-score floor). Both restrict candidates to kanji with a character row (FK safety).
- Build output (common): all **1,945 jōyō** from Yencken, the rest from the heuristic; 24,207 rows.
- **Quality verified on the build**: every classic confusable surfaces correctly (未→末, 大→太/犬, 士→土, 日→白 via 甲申旧田目白); compounds are sensible (時→持/詩/特, 語→詰/諾/話) not obscure noise.
- `getKanji` reads the table into `KanjiDetailDto.similar` (ranked, each FK-guaranteed to have a detail page). Pinned in `db.spec.ts` — "surfaces visually-similar kanji, ranked".

## Remaining near-term: the UI (F3-UI)

A "Similar kanji" section on `KanjiDetail`, alongside Parts / Words, each entry tappable to open its detail (reuse the existing kanji-tap navigation). Empty `similar` → no section.

## Attribution

**CC BY 3.0 / Lars Yencken** added to README, About, and `meta` (`similarKanjiSource`, `similarKanjiLicense`, the two export dates). Described honestly as a deterministic approximation, not curated confusable pairs.

## Roadmap — features to build on this data (decided-to-pursue, UNSCHEDULED)

The Yencken assets are richer than the two distance CSVs we ship. The **unused human-judgment files** — `flashcards.csv` (284 human-picked pairs), `kanjitester_responses` (real learner errors), the judgment YAMLs — capture _actual confusion frequency_, a stronger signal than computed geometry. Four directions, all CC BY 3.0, all post-v1 (BACKLOG.md carries the itemized entries):

1. **Accuracy precision signal.** Use similarity to cut hover/tokenizer false positives — suppress/flag a match that is a known look-alike of a much more common word (the `あー、いいよ`-class problem). Feeds the accuracy-eval harness. _Highest leverage: attacks an already-flagged problem._
2. **Orthographic search mode** (Yencken's actual thesis, ECAI-2008). Look up a kanji you can't type by picking a visually-similar one you can — a third input path beside handwriting and radical search.
3. **Confusables comparison page** (user's design). A dedicated page: a **grid** of the confusing kanji, each rendered with its **AnimCJK stroke SVG and the distinguishing strokes highlighted**, plus a mini-definition + common on/kun reading; each cell tappable to navigate. Reuses the shipped AnimCJK SVGs (M7) + kanji-tap nav. The stroke-diff (highlighting what's _different_ between two stroke sequences) is the novel part.
4. **Learner-confusion human data.** Fold `kanjitester_responses` / `flashcards` into the blend (or a separate signal) so ordering reflects _actual_ confusion frequency — surface the dangerous look-alikes first, or add a "commonly confused" marker.

Related primitive: **stroke-edit distance** is reusable for the handwriting recognizer's near-miss autocomplete (BACKLOG) and fuzzy kanji search.

## Verification

- Build: 1,945 jōyō covered by Yencken; the confusable sets surface correctly (validate 未/末, 大/太/犬, 士/土, 日/白 before shipping any weight change).
- Host: `getKanji("未").similar` leads with 末 and each entry opens. UI: the section renders and navigates; empty list → no section.
