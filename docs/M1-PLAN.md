# Milestone 1 Plan — Vocabulary search + full detail view

> **Status:** shipped. This is the original M1 spec, preserved for context. A few details changed during implementation — see [As-built deviations](#as-built-deviations) at the end for where reality diverged from the plan.

## Context

We're building a VSCode sidebar extension that clones the core of **Shirabe Jisho** (an iOS Japanese dictionary): offline vocabulary search and a rich word-detail view, themed to match the user's VSCode color theme. The repo started as the minimal `@saeris/vscode-extension-template` (single `Hello World` command, one `.cjs` build target).

Milestone 1 delivers a **walking skeleton + a complete vocabulary detail view**: type a query → real JMdict results → click → full detail (all readings/kanji, senses grouped by part-of-speech, common/JLPT badges, cross-references). Kanji drill-down, radicals, pitch accent, stroke-order animation, and example sentences are explicitly **deferred** to later milestones — but the data schema and architecture are designed so they slot in without rework.

Key decisions made with the user:

- **Data source:** `scriptin/jmdict-simplified` prebuilt JSON releases (not raw EDICT XML).
- **Runtime store:** SQLite via `@tursodatabase/database` (napi-rs v3 → Node native binding today, with a sibling `-wasm` build that gives us a future web-extension path from the _same_ async query code).
- **DB delivery:** downloaded on first activation into `globalStorage` (keeps the `.vsix` small). For M1, the local data-build writes the `.db` directly to the dev storage path; the download-from-GitHub-Release path is stubbed behind the same "ensure DB present" seam so we aren't blocked on publishing a release asset.
- **Data scope for M1:** `jmdict-eng-common` (common-only) subset — small, fast, proves the pipeline. Full dataset delivery is a later milestone.

## UI stack (webview) and state ownership

The webview is a single-page app. Deliberate anti-`useEffect` posture — each library owns one slice of state so we avoid effect-driven glue:

- **React Aria Components** — accessible interaction primitives (search field, listbox for results, focus/keyboard nav). No hand-rolled effects for a11y/DOM wiring.
- **React Hook Form + Valibot** — the search form: uncontrolled inputs, validation at the edge.
- **Class Variance Authority + CSS Modules** — styling. Variants (badge kinds: common / JLPT / POS) map to CVA's variant API; CSS Modules reference `--vscode-*` theme variables so the UI follows the active color theme for free (no hardcoded colors).
- **TanStack Query** — owns **all async/"server" state**. The webview↔host `postMessage` request/response round-trip is wrapped as a promise-returning `queryFn`, so loading/error/caching/dedup/debounce come declaratively — no async `useEffect`.
- **XState (`@xstate/react`)** — owns **UI/navigation/interaction state**. M1 uses it only for the **navigation machine** (a view stack: `search ↔ wordDetail`, `back` transitions). Reused in later milestones for the stroke-order animation player and the search-input machine. Held strictly to UI state — async state stays in TanStack Query; the two do not duplicate each other.

**Division of responsibility (the line we hold):** TanStack Query = async/server state · XState = UI/navigation/interaction state · RHF+Valibot = form state · React Aria = interaction primitives · CVA+CSS Modules = styling.

## Architecture: three build targets

VSCode runs extension code in a **Node/CommonJS extension host**, but a React UI runs in a separate **webview** (browser context). They talk over `postMessage`. Vite+ gives us the right tool for each:

| Target         | Tool                              | Output               | Purpose                                                                   |
| -------------- | --------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| Extension host | `vp pack` (tsdown)                | `dist/extension.cjs` | activate/deactivate, sidebar registration, SQLite queries, message router |
| Webview UI     | `vp build` (Vite/Rolldown)        | `dist/webview/*`     | React app, VSCode-themed, search + detail views                           |
| Data build     | `vp run build:data` (Node script) | `jisho.db`           | one-off: JSON → SQLite. NOT run per-compile                               |

The native Turso addon must stay unbundled and ship in `node_modules` (a `.node` binary can't be bundled), so it is `neverBundle`d and packaged into the `.vsix`.

## SQLite schema (host query layer)

Designed from the confirmed `@scriptin/jmdict-simplified-types` schema. Preserves the `appliesToKanji`/`appliesToKana` constraints (a kana reading may apply to only _some_ kanji spellings — a naive cross-join produces wrong readings).

- `words(id, is_common)` — one row per JMdict entry.
- `kanji(word_id, text, is_common, tags_json, position)` — kanji writings.
- `kana(word_id, text, is_common, tags_json, applies_to_kanji_json, position)` — kana readings.
- `senses(word_id, position, pos_json, field_json, misc_json, info_json, applies_to_kanji_json, applies_to_kana_json, related_json, antonym_json)` — one row per sense.
- `glosses(sense_id, lang, text, position)` — english glosses.
- `tags(tag, description)` — the JMdict tag dictionary (pos/field/misc lookups).
- `search_terms(word_id, kind, term, term_lower, is_common)` — normalized, indexed lookup rows: one per kanji text, kana text, gloss text, and romaji (kind ∈ `kanji|kana|gloss|romaji`). Indexed for exact + prefix (`LIKE 'たべ%'`) queries.

**Search engine note:** Turso/Limbo is a from-scratch SQLite-compatible engine that does **not** implement SQLite's `FTS5` module (verified against Turso docs — it _replaces_ FTS5 with a native Tantivy-backed full-text index exposing `fts_match`/`fts_score`). For M1 we therefore use **plain indexed `LIKE`/prefix queries** over `search_terms` — fast enough for the common-only (~22k entry) dataset, no extra deps, and it preserves the WASM/web-extension future. Ranked full-text gloss search (later) will adopt Turso's _native_ `fts_match` index over the same DB file.

Search strategy: detect script of the query (kana/kanji vs latin) to route it; rank exact > prefix > substring, common entries first. Lives in one query module so the UI never touches SQL. (Better relevance ranking is tracked in [BACKLOG.md](BACKLOG.md#1-rank-results-by-relevance-not-just-match-tier-fix).)

## Attribution (license requirement, not optional)

EDRDG (JMdict/JMnedict/Kradfile) is share-alike + attribution; Kanjidic is CC-BY-SA-4. Source revision strings from the data build are stored in the DB's `meta` table, and attribution is reproduced in the README (and, later, in-app credits).

## Testing / verification (end-to-end)

1. **Data build:** `vp run build:data` produces `jisho.db`; a test opens it and asserts known entries resolve (e.g. 食べる → reading たべる, sense "to eat", pos `v1`; a word whose reading `appliesToKanji` a subset — assert the constraint holds).
2. **Query layer:** unit tests on `search`/`getWord` (Japanese, English, romaji, prefix, common-first ordering, empty query).
3. **Messaging + navigation machine:** request/response correlation in isolation; XState transitions (search → wordDetail → back restores prior view).
4. **Live in VSCode:** `F5` → sidebar icon → panel → type "eat"/"たべる" → themed results → click → full detail. Toggle theme, confirm the UI follows.
5. `vp check` clean.

## Explicitly out of scope for M1 (later milestones)

Kanji detail + radical breakdown (Kradfile/Radkfile), Animcjk stroke-order animation, Kanjium pitch accent, Tatoeba example sentences, tanos JLPT word lists, handwriting input, WaniKani citations, full-dataset download-from-Release delivery. The schema + `ensureDatabase` seam are built to absorb these without restructuring.

### Reserved decision: handwriting recognition (future milestone)

Not built in M1, but the toolchain is chosen so nothing here blocks it later:

- **Capture / render:** `perfect-freehand` (Steve Ruiz, tldraw author). Retain the raw stroke data — `Array<Array<[x, y]>>` (ordered strokes → ordered points) — not just rendered SVG.
- **Recognition:** **KanjiCanvas** (Dominik Klein, MIT, fully offline, ships its own `ref-patterns.js`; notably **stroke-order and stroke-count free**, which suits learners who don't yet know canonical stroke order). It consumes the same raw `[x,y][][]` strokes and returns ranked kanji candidates that feed straight into search.
- We do **not** need full `tldraw` (a whole canvas editor — overkill for a fixed drawing box).
- Recognition (KanjiCanvas' own patterns) is **decoupled** from stroke-order _display_ (Animcjk), so the two feature tracks don't constrain each other.

## As-built deviations

Where the shipped implementation differs from the plan above:

- **No FTS5.** The plan assumed FTS5; Turso doesn't implement it. Switched to indexed `LIKE`/prefix over a `search_terms` table (see the search-engine note). Native Tantivy FTS is reserved for later.
- **`meta` table, not `manifest.json`.** Provenance/attribution is stored in a `meta` key/value table inside the DB, plus a small `jisho.db.version` sidecar used by `ensureDatabase` to detect newer builds.
- **RHF + Valibot not yet used.** The single search field didn't warrant a form library; a deferred `useDeferredValue` drives the query directly. RHF+Valibot is reserved for real forms (filters, settings).
- **Message module is `src/shared/messages.ts`** (not `host/messaging.ts`); the host router lives inline in `extension.ts`.
- **Romaji search added** (post-plan): kana readings are transliterated to Hepburn via `wanakana` at build time so `taberu` finds 食べる.
- **Packaging uses `vsce package --no-yarn`** (not `--no-dependencies`) so the native Turso addon ships from `node_modules`.
