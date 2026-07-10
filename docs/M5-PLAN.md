# Milestone 5 Plan — Morphology & multi-word search

> **Status:** planned. Integrate a real morphological analyzer so multi-word queries work (`日本語を勉強します` → 日本語 / を / 勉強 / します, each searchable) with a jisho.org-style POS breakdown UI. Read [CONVENTIONS.md](CONVENTIONS.md) first. This is the roadmap's riskiest item — the spike gates everything.

## Context

M2's rule-based deinflection handles single conjugated words, but multi-word and unspaced Japanese input needs segmentation with part-of-speech knowledge. The chosen analyzer is the author's own TypeScript port **[@saeris/kuromoji](https://github.com/Saeris/kuromoji)**, already proven in **[@saeris/remark-ayaji](https://github.com/Saeris/remark-ayaji)** (a markdown plugin that POS-color-codes Japanese text via this tokenizer) — study Ayaji's integration as the reference for API usage, dictionary loading, and POS taxonomy handling.

Study references (patterns, not code): **Sudachi** — A/B/C split modes are the reference design for segmentation granularity (short units vs compound words; matters for what "one segment" means in search). **Kagome** — multiple dictionary backends behind one API; lattice output for debugging tokenization. **Konoha** — a unified adapter interface over analyzers (the shape to copy only if we ever support a second analyzer; don't build it speculatively). **Fudoki** — POS→color UI treatment, the closest product analogue to Ayaji.

## 1. Spike (gate — do first, record numbers in the as-built)

Answer with measurements before building features:

- **Dictionary delivery:** kuromoji needs its IPADIC binary dictionaries (~tens of MB) loaded at init. How does @saeris/kuromoji expect them (dicPath of `.dat.gz` files, as upstream)? Options, in preference order: (a) add the dictionary files to the rolling `dictionary-latest` release and download alongside the DB via the existing `ensureDatabase`/download machinery into globalStorage; (b) bundle in the `.vsix` if small enough (adds to all 4 platform packages). Measure the actual size before choosing.
- **Init cost:** time-to-ready and memory (upstream kuromoji is ~1s+ and holds the dictionary in memory). Init must be **lazy** (first Japanese multi-word query, or idle) and must never block activation. If memory is prohibitive (>150MB resident), consider tokenizing in a `worker_threads` worker — measure first.
- **Extension-host compatibility:** any fs/path assumptions in the port that break under the extension host; and note findings for the M8 web host (kuromoji-in-browser needs its dicts via fetch/OPFS — record, don't build).
- **Quality sanity:** tokenize the M2/M3 test corpus (はなします, 食べた, 日本語を勉強します, たかくない) and confirm lemmas (基本形) match what deinflection produces.

**If the spike fails its budget** (size, memory, or startup unacceptable): record why, keep M2's rule table as the deinflection story, and demote this milestone's remaining items to the backlog. Don't force it.

## 2. Tokenizer service in the host

`src/host/tokenizer.ts`: lazy-initialized singleton exposing `segment(text): Segment[]` where `Segment = { surface, lemma, pos, reading? }` (plain DTO). POS values normalized to a small enum the UI can color (noun/verb/particle/adjective/adverb/auxiliary/other) — map IPADIC's Japanese POS taxonomy (名詞, 動詞, 助詞…) once, here. Unit tests against known sentences.

## 3. Multi-word search + POS breakdown UI

- **Contract:** `SearchResponse` gains `segments: SegmentDto[]` (present when the query tokenized into >1 content segment). Host: when a Japanese query yields multiple segments, search each **content** segment (skip particles/auxiliaries by POS), merge per-segment results under segment grouping — or simpler and closer to Shirabe: return segments, and let the **UI** drive per-segment searches through the existing search query (recommended: no new merge semantics in the host; the breakdown bar just re-searches on tap).
- **UI:** a segment bar above results (jisho.org's breakdown, Ayaji's coloring): each segment a tappable chip, POS-colored (CVA variants; theme-aware — derive colors from `--vscode-charts-*` variables rather than hardcoding). Tapping a chip searches that segment's lemma. The full-query results remain the default view (search the first content segment, or show "select a segment" if nothing matched whole).
- Machine: selected-segment index is UI state → machine context beside `searchQuery`.

**Success:** typing 日本語を勉強します shows a 4-chip breakdown; tapping 勉強 shows 勉強's results; particles render dimmed and un-tappable (or tappable to the particle's own entry — Shirabe does list particles; decide in implementation); latin/English queries never invoke the tokenizer.

## 4. Tokenizer-backed deinflection

When the tokenizer is ready, prefer its lemma over the M2 rule table for Japanese queries (します → する with POS context, no over-generation). Keep `deinflect.ts` as the fallback for: tokenizer-not-yet-initialized, unknown words (IPADIC misses slang/rare forms), and the romaji→kana path. The merge scoring in `Dictionary.search` stays as-is (lemma candidates enter the same 90-score channel). This closes BACKLOG #8's motivation without the type-level rework — update that backlog item accordingly.

## Build order & verification

1 (spike — gate) → 2 (service) → 3 (breakdown UI + multi-word) → 4 (lemma deinflection). Per-item commits + bump files (item 3 is `minor`). Standing gates per CONVENTIONS; tokenizer init must not regress activation time (measure); F5 pass for the breakdown UI. Append as-built + flip ROADMAP status.
