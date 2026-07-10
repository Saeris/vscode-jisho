# Roadmap

The single consolidated view of where vscode-jisho is going. Each milestone gets its own detailed plan doc when work starts (M1 and M2 already have them); this file tracks the sequence, scope boundaries, dependencies, and the standing decisions that shape them.

**Product goal:** an offline Japanese dictionary in the VSCode sidebar, functionally a clone of [Shirabe Jisho](https://ricoapps.com/)'s lookup experience — vocabulary, kanji, radicals, pitch accent, example sentences, JLPT levels, stroke order, and handwriting search. Explicitly **not** in scope, ever: flashcards, notes, cross-device sync.

## Milestone sequence

| #   | Theme                          | Status                                     | Plan                     |
| --- | ------------------------------ | ------------------------------------------ | ------------------------ |
| M1  | Vocabulary search + detail     | ✅ shipped                                 | [M1-PLAN.md](M1-PLAN.md) |
| M2  | Search quality                 | ✅ shipped                                 | [M2-PLAN.md](M2-PLAN.md) |
| M3  | Release — installable v0.1     | ✅ code complete (publish pending secrets) | [M3-PLAN.md](M3-PLAN.md) |
| M4  | Kanji as first-class           | queued                                     | —                        |
| M5  | Morphology & multi-word search | queued                                     | —                        |
| M6  | Enrichment datasets            | queued                                     | —                        |
| M7  | Stroke order & handwriting     | queued                                     | —                        |

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

The riskiest single item, deliberately sequenced after kanji: integrate the author's own TypeScript port of kuromoji — [@saeris/kuromoji](https://github.com/Saeris/kuromoji), already proven in [@saeris/remark-ayaji](https://github.com/Saeris/remark-ayaji) — as an offline morphological analyzer in the extension host. Deliverables:

- **Tokenizer integration** — evaluate IPADIC dictionary delivery (size, load time, bundling vs. download alongside the DB), startup cost, and extension-host compatibility. Gate the rest of the milestone on this spike.
- **Multi-word queries** — `日本語を勉強します` returns closest matches for each meaningful segment.
- **POS breakdown UI** — the jisho.org-style segmented rendering of the query, each segment tappable to focus the search on it.
- **Tokenizer-backed deinflection** — supersede/augment M2's rule table with real morphological analysis (します → する identified with POS context).

**Study references** (different languages, each solving an adjacent problem — extract patterns, not code): [Sudachi](https://github.com/WorksApplications/Sudachi) (Java — its A/B/C split modes and normalized forms are the reference design for segmentation granularity, which matters for "focus search on this segment"); [Kagome](https://github.com/ikawaha/kagome) (Go — multiple dictionary backends behind one API, lattice visualization for debugging tokenization, and prior art on shipping an analyzer as WASM); [Konoha](https://github.com/himkt/konoha) (Python — a unified adapter interface over many tokenizers, the shape to copy if we ever support more than one analyzer); [Fudoki](https://github.com/iamcheyan/fudoki) (POS-based color-coding of Japanese text — the closest analogue to [@saeris/remark-ayaji](https://github.com/Saeris/remark-ayaji), which does the same as a markdown plugin via [@saeris/kuromoji](https://github.com/Saeris/kuromoji)). Ayaji's POS→color treatment is itself a candidate for the M5 breakdown UI: color-coded segments for enhanced readability.

## M6 — Enrichment datasets

Layer the remaining reference data onto existing views. Each is a data-build addition plus a detail-view section — independent of each other, so this milestone can be split or reordered freely:

- **Pitch accent** (Kanjium) — accent notation on word details and result rows.
- **Example sentences** (Tatoeba, via JMdict's examples variant or Tatoeba directly) — sentences on word details, with the M2 tap-through pattern extended to sentence vocabulary (better with the M5 tokenizer).
- **JLPT word lists** (tanos.co.uk) — word-level JLPT badges (Kanjidic only covers kanji-level), plus browsable N5–N1 lists.
- **WaniKani citations** — level references and outbound links only (citation, not content reproduction).
- **JMnedict names** (~743k person/place/organization names) — a separate "Names" result section and search kind. Note: large dataset (~146MB source); relies on M3's download delivery being solid.

## M7 — Stroke order & handwriting

The drawing milestone, built on decisions reserved since M1:

- **Stroke-order animation** (AnimCJK) — animated SVG stroke order on the kanji detail view, driven by an XState animation-player machine (play/pause/step/replay — the machine XState was chosen for).
- **Handwriting search** — draw-to-search: **perfect-freehand** captures strokes (retaining raw `[x,y][][]` point data), **KanjiCanvas** (MIT, offline, stroke-order-and-count free) recognizes candidates, results feed the normal search. Recognition and display data are deliberately decoupled (KanjiCanvas ships its own reference patterns; AnimCJK is display-only).

## M8 — Web extension (vscode.dev)

Make the extension run in web-based VSCode (vscode.dev / github.dev), where the extension host is a Web Worker. Motivated by reach and by simplifying distribution (a web-compatible host is platform-independent). Key facts from the 2026-07 spike:

- **[@tursodatabase/database-wasm](https://github.com/tursodatabase/turso/tree/main/bindings/javascript) is the vehicle, and it is browser-only.** Its entry fetches the .wasm asset (file:// fetch fails in Node) and its storage backend is OPFS — so it cannot replace the native Node packages; it _complements_ them for the web host. The Node-WASI build (`database-wasm32-wasi`) is abandoned upstream (0.1.4 vs 0.6.1) and not viable.
- **Architecture:** one `Dictionary` API over an engine seam (package.json `imports`/build-condition maps `#turso` → native for the Node host, wasm for the web host); a second host bundle targeting webworker; re-add the manifest `browser` field. The webview is already browser code and needs nothing.
- **Delivery on web:** `ensureDatabase` gains an OPFS backend — download the gzipped DB (browsers have `DecompressionStream`), verify sha256 (WebCrypto), write into OPFS. Storage quota for a ~320MB DB and SharedArrayBuffer/COOP-COEP availability inside the vscode.dev extension-host worker are the open risks to spike first.
- **Perf gate:** re-run the latency probe under WASM; the index-backed search (2–75ms native) has headroom for WASM overhead, but measure before committing.

## Standing decisions (carried across milestones)

- **State ownership line:** TanStack Query = async state · XState = UI/navigation state · React Aria = interaction primitives · CVA + CSS Modules = styling · RHF + Valibot reserved for real forms.
- **Engine:** Turso/SQLite, async API, WASM sibling kept viable for an eventual web-extension build. No FTS5 — Turso's native `fts_match` is the upgrade path when `LIKE` ranking stops scaling.
- **Attribution is a feature:** every dataset addition (M4, M6) extends the credits view and the DB `meta` provenance in the same change.
- **Out of scope, permanently:** flashcards, notes, synchronization.
