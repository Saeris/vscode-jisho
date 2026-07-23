# Spec 08 — Hover consistency, POS pills, markdown-aware detection, corpus testing

**Backlog:** #33 (hover), #38 (highlighting). **Status:** **Implemented** (commits on `main`, 2026-07-20). This is an as-built record; deviations and findings are marked.

## Context

The rich word hover (spec 03 era) shipped, then review against real usage surfaced eight issues in four themes:

1. **Hover correctness** — POS pills sometimes rendered English instead of a Japanese `<kbd>`; the conjugation form wasn't tagged with `<ins title>`; a word definition and a grammar note wrongly rendered _together_ when the cursor sat on an auxiliary.
2. **Visual consistency** — grammar notes and word definitions looked quite different.
3. **Run-detection robustness** — inline markdown (`*emphasis*`, `**bold**`, `` `code` ``, `==marks==`) interleaved with Japanese fragmented runs; mirrordown's escaped-pipe ruby (`{漢字|かん\|じ}`) wasn't handled.
4. **Tokenizer/highlighting accuracy** — no test exercised tokenization over real prose, so segmentation quality was unverified.

Plus a maintainability item: `extension.ts`'s `hover()` had grown long.

Decisions taken with the user: markdown detection improved by **regex now**, unified/remark AST deferred; corpus from **both** Tatoeba (breadth) and a **substantial** Aozora work (depth + perf); assertions **properties + snapshot**; double-match resolved as **grammar note replaces definition** (one hover, one subject).

## What shipped

### A — Structural POS labels (`src/shared/hoverHtml.ts`)

`v5r-i` showed English because `POS_LABEL` enumerated codes one by one and missed some. Replaced the flat lookup with a `posLabel(code)` resolver: an explicit table for irregulars, then **structural derivation** — every `v5*` → 五段動詞, `v1*` → 一段動詞, `v4*`/`v2*` → classical 四段/二段, `vs*` → する動詞, `adj-*` → an adjective class. A newly-seen code in a known family resolves instead of dumping an English sentence into a `<kbd>` pill. The long tail still falls back to English.

### B — Conjugation form tagged with `<ins title>` (`src/host/hover.ts`)

New `describeGroupHtml` wraps each auxiliary as `<ins title="want to">〜たい</ins>` — the gloss moves into a tooltip, so the breakdown line stays compact (`食べる + 〜たい + 〜ない + 〜た`, underlined). Uses the existing `glossTag`. Plain `describeGroup` stays for non-HTML callers.

### C — One hover, one subject (`src/host/hoverProvider.ts`)

A definition and a grammar note no longer stack. The cursor sits on one thing and the hover explains **that**: on an auxiliary → its note alone; on a particle → its note; on a content word → its definition. The reported double-match (置きたい's たい showing both) is gone.

### D — Aligned grammar notes (`src/shared/grammar.ts`)

`noteToMarkdown` now shares the word hover's frame: `# heading`, `---` rule, blockquote example with a dimmed `<small>` translation. **Unlock:** an earlier belief that `supportHtml` broke the grammar hover was disproven — it was a malformed fragment, not the flag; `supportHtml` + `isTrusted` coexist fine. **Constraint confirmed by probe:** `<rt>` is 7px even in a blockquote (not just body text) and `style` is stripped, so the example's reading stays a plain second line rather than unreadable furigana — the same trade the word hover makes. Legible ruby is only possible in an `# h1` heading.

### E — Markdown-aware run detection (`src/host/hover.ts`)

`stripRuby` now also removes inline markdown markers (`*`, `**`, `_`, `` ` ``, `==`, `~~`) so `彼に*遅れない*ように` reads as one run, not three. Not a parser — just the inline markers that break a run, dropped before detection, with the index maps preserved (a dropped marker folds into a neighbour's original span). Also handles mirrordown's escaped-pipe ruby (`{漢字|かん\|じ}`, `{バー\|線|ばーせん}`).

### F — Hover orchestration extracted (`src/host/hoverProvider.ts`)

The long `hover()` moved out of `extension.ts` into a `provideHover(document, position, token, deps)` taking an injected `deps` object (settings, `segment`, DB accessors), so it's provider-free and testable. `extension.ts` keeps registration and a thin adapter.

### G — Corpus tokenizer tests (`src/host/__tests__/corpus.spec.ts`)

Two vendored public-domain corpora under `bench/fixtures/`: **羅生門** (Akutagawa, ~5,700 chars, Aozora Bunko, ruby/markers stripped, attribution header) and **50 sampled Tatoeba sentences**. Assertions are **properties** (character coverage, no empty surfaces, kanji compounds not shattered — a canary rate) plus **snapshots** of three fixed sentences. Exact tokenizations are deliberately not pinned (IPADIC is upstream).

### H — Throughput bench (`bench/tokenize.bench.ts`)

Tokenization and the highlighting walk over a whole **novel** — 吾輩は猫である (Sōseki, ~2,255 lines / ~320K chars, `bench/fixtures/wagahai-neko.txt`) — the heavy-document "did my change help?" signal the recognizer bench lacked. A short excerpt hides per-call overhead and allocation churn; sustained novel-scale load is where perf work pays off. Whole document ~4.2s, highlight walk ~3.9s, one sentence ~0.22ms. The whole-document cases use a few fixed iterations (they are ~4s each) so `vp run bench` stays practical. WASM is opaque to deoptkit (spec 07), so throughput only. The correctness tests keep the smaller 羅生門 fixture, where fast stable runs matter more than weight.

## Findings surfaced by the corpus (recorded, not fixed here)

The corpus earned its keep immediately:

- **IPADIC drops whitespace adjacent to embedded Latin**: `下人の Sentimentalisme に` → `下人のSentimentalismeに`. Loses no Japanese, only affects mixed-script prose with foreign words. The coverage assertion compares non-space content; the space handling is a known gap.
- **Folding quirks** in the snapshots: `事である` folded onto the 事 noun (copula attached); `ある日` tagged 連体詞 → adjective; `一人` lemma reduced to `一`. IPADIC/folding realities, visible in the snapshot for future review, out of scope for this pass.

## Deferred (follow-up specs)

- **unified/remark AST parsing** for run detection. The regex pass covers the reported cases; migrate to an mdast text-node walk if gaps persist on heavier markdown. Cost: unified/remark are ESM-only (bundling friction into the CJS host, size). Note `highlighting.enabled` defaults **false**, lowering urgency.
- **Reconciling the two POS taxonomies** — the tokenizer's 7-bucket enum (drives coloring/segmentation) vs JMdict's `TagDto` codes (drive pills). The corpus snapshots are the evidence base for whether the coloring taxonomy needs expanding.
- **The IPADIC folding quirks and Latin-space handling** above, if they prove to matter in practice.

## Verification (as run)

- `vp check` clean, `vp test --run` green (281 unit/component/browser).
- Hover E2E (reliable via `hoverEditorWord`): definition hover, particle note, **auxiliary-note-only** (the double-match fix), screenshot-checked.
- `vp run bench` produces the tokenize numbers above.
