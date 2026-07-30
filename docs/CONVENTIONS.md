# Implementation conventions & hard-won lessons

Read this before executing any milestone plan. It captures workflow rules and engine gotchas discovered during M1–M3 so they don't get re-learned the hard way. Milestone plans reference this instead of repeating it.

## Workflow

- **One commit + one Bumpy bump file per shippable item** (`vp exec bumpy add --packages "vscode-jisho:<patch|minor>" --name "<slug>" --message "<changelog body>"`; docs-only changes use `--empty`). Commit directly to `main`; Bumpy folds bump files into the version PR.
- **Standing gate after every item:** `vp check` clean (format+lint+typecheck; run `vp check --fix` first) and `vp test` green. Prefer Wallaby MCP for test feedback when alive; fall back to `vp test`.
- **Soft-wrap all Markdown and prose** (commit bodies, docs, comments): one line per paragraph/bullet, no hard column wrapping.
- **Milestone lifecycle:** plan doc exists before work starts → implement in the plan's build order → append an "As-built deviations" section on completion → flip the milestone's status in [ROADMAP.md](ROADMAP.md).
- Plans are starting points, not contracts: when measurements or data reality contradict the plan (it has happened every milestone), follow the measurement and record the deviation.
- Temporary probe scripts go at repo root as `*.tmp.mjs` / `*.tmp.spec.ts`, run, then delete. Note: raw `node` cannot resolve the repo's extensionless relative TS imports — run probes that import `src/` modules through a temp `.spec.ts` via `vp test <file>` instead.

## Turso / SQLite engine gotchas

- **`db.prepare()` is async** — always `await` it (runtime is lenient today; the types are not, and the WASM future won't be).
- **No FTS5.** Turso replaces it with a native Tantivy index (`fts_match`) that we deliberately don't use yet. Search must stay **index-friendly**: exact matches and range scans (`col >= ? AND col < ?||'￿'`) only. **Never add an unanchored `LIKE '%…%'`** — at full-dictionary scale (~3M `search_terms` rows) it costs 400ms–3s per query. Precompute containment at build time instead (see the `word`/`char` kinds in `src/data/schema.sql`).
- **`IN (…)` is not index-optimized either** (measured 2026-07-29): `term IN (?,?…)` cost 0.3788ms against 0.0200ms for the equivalent `term = ? OR term = ?` chain on `search_terms` — a 19x full-scan penalty on the _common_ subset, and it grows with the table. Same rule as the LIKE ban: build OR chains from a parameter list instead. `kind IN ('kanji','kana')` over a tiny literal set is fine; it is the indexed-column lookups that matter.
- **`prepare()` is not free and is not cached for you** — re-parsing and re-planning each call measured 4x the cost of reusing a statement (0.0158ms vs 0.0039ms). `Dictionary` caches by SQL text; keep query SQL constant where you can, since variable-length parameter lists get one cache entry per length.
- **The dictionary is opened READ-ONLY, and that is load-bearing** (`SqliteStore.open`). Nothing in the query layer writes, so it was permission we never used — but the reason to keep it is concurrency: a writable connection is EXCLUSIVE across processes, and Vitest runs test files in parallel workers, so two DB-backed specs collided with "File is locked by another process". `db.spec`, `accuracy.spec` and `names.spec` previously coexisted only by scheduling luck; a fourth would have flaked. Read-only connections share the file, so those specs ARE the regression guard — there is no synthetic test for it, because the property is cross-process and a same-process test passes either way. If you ever need a writable handle, copy the file first (see db.spec's `withCorruptedCopy`).
- **Bulk imports must commit in batches** (~5k rows) with `PRAGMA wal_checkpoint(TRUNCATE)` between batches — one giant transaction ballooned the WAL past 5GB. Always checkpoint before `close()` so the shipped `.db` is self-contained.
- Statement results are `any`; route all reads through `Dictionary`'s typed `#all`/`#get` helpers in [src/host/db.ts](../src/host/db.ts).

## Data build & delivery

- `vp run build:data` = common-only dev/test fixture (~101MB, ~60s, measured 2026-07-29). `vp run build:data:full` = full dictionary + the zstd-compressed release asset trio (`jisho-full.db.zst`, `.zst.sha256`, `.zst.version`); `vp run build:data:names` = the JMnedict DB (409MB, ~50s to build + ~120s to compress — pass `--no-archive` to skip the archive when you only need something to query).
- **The full-variant figures previously recorded here (~320MB, ~4min) are unverified since the Tatoeba pool landed** — that pool doubled the common fixture (51MB → 101MB), so expect the full DB to have grown similarly. Re-measure at the next full build rather than trusting the old numbers.
- **Reproducibility is deliberately mixed — know which half you are in.** Some sources are pinned by revision and some roll, so "the same build command" does NOT always produce the same database:
  - **Pinned by SHA** (a change is a reviewable commit): the JLPT repo, cjk-decomp, Kanjium, and AnimCJK (`ANIMCJK_SHA` in `scripts/acjk.ts` — one constant, two consumers, so radical positions can never be classified against different data than the stroke SVGs ship from).
  - **Rolling by design**: jmdict-simplified resolves `releases/latest`, because dictionary refreshes are decoupled from extension releases — a maintainer-triggered data build is supposed to pick up current JMdict without a code change. Set `JISHO_JMDICT_RELEASE=<tag>` to pin it when reproducing a specific build; the resolved tag is recorded in `meta.dictRelease` either way, so any database says what it came from.
  - **Rolling and unpinnable**: the three Tatoeba exports (rebuilt weekly at a stable URL), JMdict XML over EDRDG's FTP, and the Yencken CSVs — none of these publish a version. Their last-modified dates go into `meta` (`tatoeba*Date`, `similarKanji*Date`), which is the closest thing to a version available. To reproduce a build older than the current exports you would need your own archived copies.
- **The build gates its own output** (`FLOORS`/`RATE_FLOORS` in `scripts/build-data.ts`): coverage figures that used to be printed and forgotten now fail the build if they collapse, and a failed build deletes its partial `.db` rather than leaving one that `verify-db` would pass. Floors are empirical with wide margins — when a figure legitimately drops, move the floor and record why.
- **Any schema or data change requires rebuilding both variants** and re-uploading the full trio to the rolling `dictionary-latest` GitHub Release (`gh release upload dictionary-latest --clobber assets/jisho-full.db.zst*`). The `.version` sidecar propagates the refresh to installed clients automatically; the bundled-dev path refreshes F5 automatically.
- Ranking-sensitive changes must keep the db.spec ranking tests green ("study"→勉強, "eat"→食べる above 飲食, "water"→水, "cat"→猫; deinflection: はなします→話す) and should re-run the latency probe on the **full** DB (budget: <150ms; current: 2–75ms).
- **Every new dataset must extend attribution in the same change:** the About view ([src/webview/views/About.tsx](../src/webview/views/About.tsx)), the README's data-sources section, and provenance keys in the DB `meta` table.

## Host ↔ webview

- The message contract lives in [src/shared/messages.ts](../src/shared/messages.ts): request/response pairs correlated by `requestId`. **DTOs must be plain structured-clone-safe objects** (no Map/Set/Date). New requests: add types → `Dictionary` method → `respond()` case in [src/extension.ts](../src/extension.ts) → bridge function → TanStack Query options in [src/webview/queries.ts](../src/webview/queries.ts).
- **State ownership line (hold it):** TanStack Query = all async state (bridge calls as `queryFn`) · XState navigation machine ([src/webview/machines/navigation.ts](../src/webview/machines/navigation.ts)) = view stack + UI state · React Aria = interaction primitives · CVA + CSS Modules over `--vscode-*` vars = styling (no hardcoded colors, no `prefers-color-scheme`) · RHF+Valibot reserved for real forms.
- New views: extend the machine's `View` union + an event + a case in [src/webview/App.tsx](../src/webview/App.tsx). The search view stays mounted via React `<Activity>`; pushed views render as siblings.
- The webview targets one known Chromium (Electron) — no cross-browser fallbacks needed. CSP: scripts need the nonce; assets via `webview.cspSource`.

## Packaging

- `@tursodatabase/*` is `neverBundle`d and ships in the `.vsix` from `node_modules`; everything else the host imports gets bundled into `dist/extension.cjs` (verify externals stay `vscode` + `@tursodatabase/database` only: `grep -oE 'require\("[^"]+"\)' dist/extension.cjs`).
- `vsce` always with `--no-yarn` (its yarn integration is Yarn-v1-only). Per-platform packages: `vp run build:platforms` (4 targets; **no darwin-x64** — turso ships no Intel-Mac binary). Bumpy's build/publish commands already point at the platform scripts.
- The manifest has **no `browser` field** until M8 — the host is Node-only today.

## Theming & contrast

- All colors derive from `--vscode-*` variables (via the `--jisho-*` bridge in `theme.css`) so the UI follows the user's theme. The cost: we don't control the resolved values, so **every derived color must be judged in BOTH light and dark modes** — a hue that reads fine on dark can wash out on light (charts-orange did exactly this).
- Standard: aim for APCA-level legibility, not just "looks okay on my theme" — and **work in oklch across the board** (user preference, 2026-07-17): all `color-mix()` interpolation happens `in oklch`, never srgb (srgb blending muddies both hue and lightness — it shipped an illegible tan twice). For accent hues used as TEXT, don't blend at all — construct with relative color syntax: `oklch(from var(--jisho-fg) l <chroma> <hue>)` takes the LIGHTNESS from the theme's own foreground (which contrasts with the background by definition, so the accent inherits body-text legibility exactly, APCA tracking lightness difference) and paints the hue onto it. For accents over the stroke canvas, an outline in `--jisho-bg` (paint-order: stroke) is the working pattern.
- Verify with pixels, not guesses: `e2e/visual-light.e2e.ts` launches VS Code with a stock light theme (`launchVSCode({ "workbench.colorTheme": ... })`) and captures the contrast-sensitive pages. Add a capture there whenever a new derived color ships.
