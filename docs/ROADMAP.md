# Roadmap

The single consolidated view of where vscode-jisho is going. Every milestone has its own plan doc (linked below); implementers should read [CONVENTIONS.md](CONVENTIONS.md) first — it captures the workflow rules and engine gotchas learned in M1–M3. This file tracks the sequence, scope boundaries, dependencies, and the standing decisions that shape them.

**Product goal:** an offline Japanese dictionary in the VSCode sidebar, functionally a clone of [Shirabe Jisho](https://ricoapps.com/)'s lookup experience — vocabulary, kanji, radicals, pitch accent, example sentences, JLPT levels, stroke order, and handwriting search. Explicitly **not** in scope, ever: flashcards, notes, cross-device sync.

## Milestone sequence

| #   | Theme                          | Status                                 | Plan                     |
| --- | ------------------------------ | -------------------------------------- | ------------------------ |
| M1  | Vocabulary search + detail     | ✅ shipped                             | [M1-PLAN.md](M1-PLAN.md) |
| M2  | Search quality                 | ✅ shipped                             | [M2-PLAN.md](M2-PLAN.md) |
| M3  | Release — installable v0.1     | ✅ code complete; see the v1 checklist | [M3-PLAN.md](M3-PLAN.md) |
| M4  | Kanji as first-class           | ✅ shipped                             | [M4-PLAN.md](M4-PLAN.md) |
| M5  | Morphology & multi-word search | ✅ shipped                             | [M5-PLAN.md](M5-PLAN.md) |
| M6  | Enrichment datasets            | ✅ shipped                             | [M6-PLAN.md](M6-PLAN.md) |
| M7  | Stroke order & handwriting     | ✅ shipped                             | [M7-PLAN.md](M7-PLAN.md) |
| M8  | Web extension (vscode.dev)     | post-v1, feasibility settled           | [M8-PLAN.md](M8-PLAN.md) |

## v1 release checklist — the actual remaining work

Every feature milestone has shipped. What is left before the first public release is **not features**; it is the short list below. Anything not on this list is post-v1 by definition, however desirable — see [BACKLOG.md](BACKLOG.md).

Audited against the code and CI on 2026-08-06.

### Blocking

| #   | Item                                                                                                                                                                                            | State                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R1  | **Documentation spike** — a dedicated pass over README, the docs tree, and in-repo guidance. Deliberately sequenced LAST, immediately before publishing, so it documents what actually shipped. | not started; scope to be detailed separately       |
| R2  | **Freeze the schema** — flip `SCHEMA_FROZEN` in [src/shared/schema.ts](../src/shared/schema.ts) and pin the hash. The drift guard is inert until this happens.                                  | `SCHEMA_FROZEN = false`, `SCHEMA_VERSION = 6`      |
| R3  | **Merge the Bumpy version PR** and run the first publish.                                                                                                                                       | PR #1 open since 2026-07-11; version still `0.0.0` |

**Open VSX is out of scope for v1** (decided 2026-08-06). v1 targets the editor the extension was built and tested in; publishing to a second registry means a namespace claim, another token, and editors (VSCodium, Cursor, Gitpod) that are not part of the release test. `publish-vsix.ts` and `release.yml` are Marketplace-only, so the missing `OVSX_PAT` can no longer half-publish a release — the loop previously ran Marketplace-then-Open-VSX per platform, which would have failed _after_ platform 1 had already gone live. Revisit as its own piece of work post-v1.

### Not blocking, but wanted for a _polished_ v1

These are judgement calls, listed in the order they were queued. Cutting any of them delays nothing.

- **BACKLOG #16** — breakdown bar filters the sentence in place instead of re-searching destructively. Queued directly after the tooltip work.
- **BACKLOG #32** — word-detail layout redesign toward Shirabe's definition formatting. A design-review loop with live screenshots, not a one-shot.
- **BACKLOG #23** — pitch contour overlaid on the kana rather than banded above. The author already judged the band "good enough"; do this only if it grates in use.

### Already done, contrary to older notes

The release blocker is **gone**: `dictionary-latest` is published and complete (word DB, names DB, checksums, version sidecars). BACKLOG items #10, #17, #21, #27 and #54 have shipped — only their headings lagged. The engine floor is now stated honestly (`vscode ^1.123`, `node >=24.15`) and CI tests exactly the two runtimes we ship to.

## M1 — Vocabulary search + detail (shipped)

Offline JMdict search (kanji / kana / Hepburn romaji / English) with ranked results and a full word-detail view (readings, writings, senses by part of speech, common badges, cross-references), in a React webview themed to VSCode. Data pipeline compiles jmdict-simplified into a local Turso/SQLite database. See [M1-PLAN.md](M1-PLAN.md) including its as-built deviations.

## M2 — Search quality (shipped)

Make everyday queries behave the way learners expect, refining M1 with no new datasets. Four items, each shipped as its own commit — full detail and as-built deviations in [M2-PLAN.md](M2-PLAN.md):

1. **Relevance ranking** — composite scoring so "to study" surfaces 勉強する, not substring noise.
2. **Persist search state on back** — query + results survive detail-view navigation.
3. **Deinflection** — conjugated input (はなします) matches dictionary forms (話す) via a rule table.
4. **Tap-through on cross-references** — xrefs in the detail view become navigable.

## M3 — Release: installable v0.1

Turn "works via F5" into "anyone can install it." This lands immediately after M2 so real users generate feedback before more feature depth is added. Deliverables:

- **Download-on-activation DB delivery** — implement the stubbed backend in `ensureDatabase`: fetch the prebuilt database from a GitHub Release asset into `globalStorage` with a `withProgress` UI, resumable/retryable, verified by checksum. The version-sidecar refresh logic already exists.
- **Full dictionary** — switch the delivered DB to full JMdict (~217k entries; expect a 150–250MB artifact). The data build grows a `--full` / `--common` flag; **common-only stays as the dev/test fixture** (small, fast, committed to Releases separately). Validate search latency at full scale (the `LIKE`-based ranking must stay responsive; if it doesn't, this is where Turso's native `fts_match` index gets adopted).
- **Per-platform packaging** — `vsce package --target win32-x64 | darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64`, each carrying the matching `@tursodatabase` native binary. CI matrix builds all targets.
- **In-app credits/licenses view** — EDRDG attribution is a license obligation, surfaced in the UI (a simple "About" section in the webview reading the DB `meta` table), not just the README.
- **Marketplace + Open VSX publish** — wire the repo environment secrets (`VSCE_PAT`, `OVSX_PAT`, `BUMPY_GH_TOKEN`), merge the accumulated Bumpy version PR, first automated publish.

**Risks/unknowns:** full-DB build memory/time (the 114MB source JSON is parsed in one pass today — may need streaming); GitHub Release asset size limits (2GB — fine); whether `ovsx publish` needs its own yarn workaround like `vsce --no-yarn` did.

## M4 — Kanji as first-class

Add the character half of the dictionary. Backed by two new datasets from the same jmdict-simplified pipeline: **Kanjidic2** (readings, meanings, stroke counts, grade, JLPT level, frequency) and **Kradfile/Radkfile** (radical decomposition, from the original Kradfile-u source list). Deliverables:

- **Kanji in search results** — searching 食 shows the character itself (with its meanings/readings) in a "Kanji" section alongside the "Words" section, Shirabe-style mixed results.
- **Kanji detail view** — on/kun readings, nanori, meanings, stroke count, grade, JLPT, frequency rank, and the radical/component breakdown; components link to other kanji using them.
- **Vocab ↔ kanji cross-navigation** — tap a kanji in a word's headword to open its detail; from a kanji, list common words containing it.
- **Radical-based lookup** — Shirabe's "Radicals" search mode: pick components, narrow candidate kanji (Radkfile drives this). May slip to M7 if the milestone runs long — it's separable.

Schema grows `kanji_characters` (+ radical tables) and new `search_terms` kinds; the navigation machine gains a `kanjiDetail` view (it was designed for this).

## M5 — Morphology & multi-word search

The riskiest single item, deliberately sequenced after kanji. **Engine decided (2026-07): [Lindera](https://github.com/lindera/lindera) compiled to WASM** ([lindera-wasm](https://github.com/lindera/lindera-wasm)) — a Vibrato/MeCab-quality Rust tokenizer, the current state of the art, with the same WASM artifact running in the Node host now and the M8 web worker later (largely dissolving M8's engine-seam risk). Chosen over a hand-rolled TS Viterbi or the author's older [@saeris/kuromoji](https://github.com/Saeris/kuromoji) port for cutting-edge quality + longevity; the _integration_ layer (service wrapper, POS→search/deinflection/UI, delivery) stays purpose-built. Full detail and the grounded package facts (IPADIC ~12.5MB / UniDic ~44.7MB, embedded dict, async WASM init, `nodejs`/`web` split) in [M5-PLAN.md](M5-PLAN.md). Deliverables: tokenizer service (spike-gated), multi-word queries, jisho.org-style POS breakdown UI, tokenizer-backed deinflection, and the folded-in keyboard-nav items (BACKLOG #11/#12).

**Study references** (patterns, not code): [Sudachi](https://github.com/WorksApplications/Sudachi) A/B/C split modes (segmentation granularity — Lindera's normal/decompose modes are the analogue); [Fudoki](https://github.com/iamcheyan/fudoki) / [@saeris/remark-ayaji](https://github.com/Saeris/remark-ayaji) POS→color UI treatment for the breakdown bar.

## M6 — Enrichment datasets (shipped)

Layered the remaining reference data onto existing views. Each was a data-build addition plus a detail-view section — see [M6-PLAN.md](M6-PLAN.md) for as-built details:

- **Pitch accent** (Kanjium) — accent notation on word details and result rows.
- **Example sentences** (Tatoeba, via JMdict's examples variant or Tatoeba directly) — sentences on word details, with the M2 tap-through pattern extended to sentence vocabulary (better with the M5 tokenizer).
- **JLPT word lists** (tanos.co.uk) — word-level JLPT badges (Kanjidic only covers kanji-level), plus browsable N5–N1 lists.
- **WaniKani citations** — level references and outbound links only (citation, not content reproduction).
- **JMnedict names** (~743k person/place/organization names) — a separate "Names" result section and search kind. Note: large dataset (~146MB source); relies on M3's download delivery being solid.

## M7 — Stroke order & handwriting (shipped)

The drawing milestone, built on decisions reserved since M1 — see [M7-PLAN.md](M7-PLAN.md) for as-built details:

- **Stroke-order animation** (AnimCJK) — animated SVG stroke order on the kanji detail view, driven by an XState animation-player machine (play/pause/step/replay — the machine XState was chosen for).
- **Handwriting search** — draw-to-search: **perfect-freehand** captures strokes (retaining raw `[x,y][][]` point data), **KanjiCanvas** (MIT, offline, stroke-order-and-count free) recognizes candidates, results feed the normal search. Recognition and display data are deliberately decoupled (KanjiCanvas ships its own reference patterns; AnimCJK is display-only).

## M8 — Web extension (vscode.dev)

Make the extension run in web-based VSCode (vscode.dev / github.dev), where the extension host is a Web Worker. Motivated by reach and by simplifying distribution (a web-compatible host is platform-independent). Key facts from the 2026-07 spike:

- **[@tursodatabase/database-wasm](https://github.com/tursodatabase/turso/tree/main/bindings/javascript) is the vehicle, and it is browser-only.** Its entry fetches the .wasm asset (file:// fetch fails in Node) and its storage backend is OPFS — so it cannot replace the native Node packages; it _complements_ them for the web host. The Node-WASI build (`database-wasm32-wasi`) is abandoned upstream (0.1.4 vs 0.6.1) and not viable.
- **Architecture:** one `Dictionary` API over an engine seam (package.json `imports`/build-condition maps `#turso` → native for the Node host, wasm for the web host); a second host bundle targeting webworker; re-add the manifest `browser` field. The webview is already browser code and needs nothing.
- **Delivery on web:** `ensureDatabase` gains an OPFS backend — download the gzipped DB (browsers have `DecompressionStream`), verify sha256 (WebCrypto), write into OPFS. Storage quota for a ~320MB DB and SharedArrayBuffer/COOP-COEP availability inside the vscode.dev extension-host worker are the open risks to spike first.
- **Perf gate:** re-run the latency probe under WASM; the index-backed search (2–75ms native) has headroom for WASM overhead, but measure before committing.

## Standing decisions (carried across milestones)

> The milestone bodies above are kept as the record of what was PLANNED at the time, including premises that later changed — the M5 section still says the tokenizer is WASM and M8 still assumes Turso. Where a milestone body and this list disagree, **this list is current**.

- **State ownership line:** TanStack Query = async state · XState = UI/navigation state · React Aria = interaction primitives · CVA + CSS Modules = styling. React Hook Form and Valibot were removed in 2026-08 — there are no forms, and carrying them broke `vsce package`. Reintroduce them if a real form ever appears.
- **Engine (superseded 2026-08):** `node:sqlite`, not Turso. Turso never finished the browse queries at full scale (its planner scans 218k rows rather than using the join) and 0.7.2 did not fix it; `node:sqlite` measured 4–10× faster cold and restores darwin-x64. The store is the seam — see [BACKLOG.md](BACKLOG.md) and the `node-sqlite-engine` change. FTS5 is available in the bundled SQLite but is not used yet; `LIKE` ranking is still fast enough.
- **Runtime floor:** VSCode `^1.123` fixes both runtimes exactly — Node **24.15** (extension host) and Chromium **148** (webview). They are not interchangeable: `Uint8Array.fromBase64` exists in Chromium 148 but not Node 24. CI pins the same 24.15 rather than a matrix; raise both together, and note VSCode has never shipped Node 26.
- **Tokenizer:** Lindera **native** via `lindera-nodejs`, on IPADIC — not the WASM build the M5 text below describes. UniDic was evaluated and rejected (SUW-only, splits 図書館); NEologd rejected on size/licence/staleness.
- **Attribution is a feature:** every dataset addition (M4, M6) extends the credits view and the DB `meta` provenance in the same change.
- **Out of scope, permanently:** flashcards, notes, synchronization.
