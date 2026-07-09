# Milestone 2 Plan — Search quality

> **Status:** planned. Theme chosen: make search behave the way users expect, refining M1 without adding new datasets or heavy dependencies. Draws items #1, #2, #6, #7 from [BACKLOG.md](BACKLOG.md).

## Context

M1 shipped a working offline vocabulary search + detail view, but testing exposed four quality gaps that hurt everyday use. All four are refinements to existing M1 code — no new content type, no new large dependency, low risk. M2 fixes them so a learner's typical queries "just work".

The four, in the order they should be built (dependency-light first, each independently shippable):

1. **Relevance ranking** — obvious answers rank near the top.
2. **Persist search state on back** — returning from a detail view restores the query and results.
3. **Deinflection** — conjugated input (`はなします`) matches the dictionary form (話す).
4. **Tap-through** — cross-references (and later gloss/example terms) are clickable to search.

Explicitly _not_ in M2 (they need a tokenizer or a new dataset): multi-word POS breakdown (#3), the tokenizer itself (#4), and kanji-vs-vocab result separation (#5). Those belong to a later "kanji as first-class" / "morphology" milestone.

## 1. Relevance ranking (fix — highest leverage)

**Problem.** `src/host/db.ts` `search` currently orders only by match tier (`exact > prefix > substring`) with `is_common` as a tiebreak. So "to study" buries 勉強する because "study" is a substring of many glosses before it's a standalone sense. Every query is affected.

**Approach.** Replace the single `rank` with a composite **score** computed in SQL over `search_terms`, ordered `score DESC`. Signals, strongest first:

- **Match tier** — exact (0) beats prefix beats substring, as today, but as one term in the score rather than the sole sort key.
- **Term kind** — a match on `kanji`/`kana`/`romaji` (the headword itself) should generally outrank a `gloss` substring; a _whole-word_ gloss match should outrank a mid-word substring. (Whole-word gloss match ≈ `term = needle` OR the needle sits on word boundaries — approximate with `term = needle` first, refine with `LIKE '% needle %'` / prefix / suffix variants.)
- **Headword length / term length** — shorter is more likely the base word (勉強 over 勉強家); add a mild penalty for longer matched terms.
- **Common flag** — keep as a positive signal, not the primary key.

Keep it a single SQL query where possible (a `CASE`-built numeric score, `GROUP BY word_id` taking the best-scoring term per word, `ORDER BY score DESC, is_common DESC`). If SQL gets unwieldy, compute the score in the query layer after fetching candidate rows — but prefer SQL to avoid over-fetching.

**Files:** `src/host/db.ts` (`search`). No schema change needed — `search_terms` already carries `kind`, `term`, `is_common`.

**Success criteria (tests in `src/host/__tests__/db.spec.ts`):**

- "to study" → 勉強する in the top few results (assert it beats an arbitrary substring match like 見学 "observation/study tour").
- "eat" → 食べる ranks above compounds that merely contain "eat" in a gloss.
- Existing exact/prefix/kana/romaji tests still pass (no regression in what matches, only in ordering).

## 2. Persist search state across back navigation (fix — small)

**Problem.** Clicking "Back" from a word detail returns to an _empty_ search — `SearchResults` holds its query in local `useState`, which unmounts when the view switches to `wordDetail` and remounts fresh on back.

**Approach.** Lift the search query out of `SearchResults`'s local state so it survives the view switch. Two clean options; prefer whichever keeps state ownership honest:

- **(a) In `App.tsx`:** hold the query in `App` (or a small context) above the `switch`, pass it down to `SearchResults` as a controlled value. Simplest; the search view is always mounted-in-spirit.
- **(b) In the XState navigation machine:** add `query` to the `search` view's context so it's part of navigation state. Fits the "XState owns UI/navigation state" line, and generalizes to remembering scroll offset later.

TanStack Query already caches the results for a given query key, so once the query text is restored the results reappear without a re-fetch (assuming the cache hasn't been GC'd — `staleTime: Infinity` in `index.tsx` keeps them). Restoring scroll offset is a nice-to-have, not required for M2.

**Files:** `src/webview/App.tsx`, `src/webview/views/SearchResults.tsx`, possibly `src/webview/machines/navigation.ts`.

**Success criteria:** unit-test that navigating search → wordDetail → back preserves the query (machine test if approach (b); otherwise a component test). Manual: search "eat", open a result, press Back → the query and result list are still there.

## 3. Deinflection (feature)

**Problem.** `はなします` / `hanashimasu` returns nothing — JMdict stores the dictionary form (話す/はなし) and our `LIKE` matches only literal terms. Learners search conjugated forms constantly.

**Approach.** A rule-based deinflection pass in the query layer that runs _before_ the DB search: given the raw query, generate candidate dictionary forms by stripping common inflections, then search the original query **plus** each candidate, merging results (deduped by `word_id`, original-form matches ranked above deinflected ones).

Rules to cover (verbs and い/な-adjectives): polite `-ます/-ました/-ません`, te-form `-て/-で`, past `-た/-だ`, negative `-ない/-なかった`, potential/passive/causative `-れる/-られる/-せる`, volitional, conditional, and い-adj `-く/-かった/-くない`. Use an existing well-tested rule table as reference — **Yomitan** or **10ten**'s deinflection rules (permissively licensed) — rather than inventing the ruleset. This is bounded and deterministic; no ML, no tokenizer (a full tokenizer is the _later_ milestone and would supersede this, but rule-based deinflection is the right M2-sized step).

Applies to kana input primarily; romaji input can be converted to kana first (we already depend on `wanakana`, which does `toKana`) then deinflected, or deinflected on the romaji surface — decide during implementation.

**Files:** a new `src/host/deinflect.ts` (pure function: `string → string[]` candidate forms, unit-testable in isolation), wired into `src/host/db.ts` `search`.

**Success criteria (tests):**

- `はなします` → 話す in results; `食べた` → 食べる; `たかくない` → 高い.
- `deinflect()` unit tests for each rule class (encode _why_: each maps a real conjugation learners type).
- No false positives that break exact matches (e.g. a word literally ending in ます like a dictionary form isn't wrongly stripped when it already matches).

## 4. Tap-through on cross-references (feature)

**Problem.** `WordDetail` already _renders_ `related`/`antonym` cross-references (see `src/webview/views/WordDetail.tsx`), but they're inert text. Shirabe lets you tap a referenced term to jump to it.

**Approach (M2 scope: xrefs only).** Render each xref term as a button that dispatches navigation to that word. Since xrefs are surface strings (not ids), tapping one runs a **search** for that term and opens the top result (or shows the result list if ambiguous) — the navigation machine already has `openWord`; add the flow to go from an xref string → search → open. Give xrefs a subtle affordance (link color + hover underline) so it's clear they're interactive — improving on Shirabe, which doesn't signal tappability well.

Gloss-word and example-sentence tap-through are explicitly deferred (they need term extraction / the tokenizer). M2 does xrefs only, which is self-contained.

**Files:** `src/webview/views/WordDetail.tsx` (+ its CSS module), possibly a small helper on the navigation machine or a "search-and-open-first" query.

**Success criteria:** clicking an xref navigates to that word's detail (or its search results); xrefs are visually distinguishable as interactive. Component/machine test for the navigation dispatch.

## Suggested build order

1. **#1 relevance ranking** — biggest impact, self-contained, pure query-layer + tests.
2. **#2 persist-on-back** — small, independent, immediate UX win.
3. **#3 deinflection** — new pure module + query wiring; the meatiest correctness gain.
4. **#4 tap-through xrefs** — interaction polish, best once results/ranking are solid.

Each lands as its own commit + bump file. None requires a new dataset or a rebuild of the schema (deinflection and ranking are query-time; persist and tap-through are webview-only).

## Verification

Per item above, plus the standing gate: `vp check` clean and `vp test` green after each. Manual pass in F5 for the two UI items (persist-on-back, tap-through) and a spot-check of ranking quality on real queries ("to study", "eat", "water", conjugated verbs).
