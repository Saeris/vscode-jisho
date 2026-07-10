# Milestone 3 Plan — Release: installable v0.1

> **Status:** code complete — items 1–4 shipped; item 5 (publish handoff) awaits the repo owner's actions listed below. See [As-built deviations](#as-built-deviations) at the end.

## Context

M1/M2 produced a working, search-quality-tuned dictionary — but only for developers: the `.vsix` ships without a database (the download backend is a stub), only for the build machine's platform, and nothing is published. M3 closes those gaps. It deliberately precedes further feature work so real users generate feedback early.

Standing decisions from the roadmap review: the delivered DB is the **full** JMdict (~217k entries); the common-only subset stays as the dev/test fixture; release/infra work all lands in this one milestone.

## 1. Full-dictionary build variant

`vp run build:data` gains a `--full` flag: download `jmdict-eng-<ver>.json.tgz` (the full English dictionary) instead of `jmdict-eng-common-*`. Same schema, same pipeline. The `meta` table and the `.version` sidecar record the variant so `ensureDatabase`'s refresh logic distinguishes them.

**Gate before proceeding:** measure on the full DB —

- build time/memory (the source JSON is parsed in one pass; switch to streaming only if it actually breaks),
- DB file size (expect roughly 10× the 23MB common build; it compresses well — the release asset ships gzipped),
- **search latency**: the substring tier (`LIKE '%…%'`) cannot use an index, so it full-scans `search_terms` (~1.4M rows at full size). If a typical query exceeds ~150ms, mitigate — first candidate: skip the bare-substring tier for 1-character queries; second: adopt Turso's native `fts_match` (the planned upgrade path). Decide with measurements, not vibes.

**Files:** `scripts/build-data.ts` (flag + asset selection + gzip emission `jisho-full.db.gz` + `.sha256`), `package.json` (script variant `build:data:full`).

## 2. Download-on-activation delivery

Implement the stubbed release backend in `src/host/ensureDatabase.ts`:

- **Hosting:** a dedicated rolling GitHub Release on this repo, tag **`dictionary-latest`**, holding `jisho-full.db.gz` + `jisho-full.db.gz.sha256`. Decoupled from extension version releases so dictionary refreshes don't require an extension release (the extension re-downloads when the version sidecar in the asset differs). Uploading/refreshing the asset is a documented `gh release` command for now; CI automation can come later.
- **Flow:** no bundled `assets/jisho.db` (the installed case) → `vscode.window.withProgress` download → stream-gunzip to a temp file in `globalStorage` → verify sha256 → atomic rename to `jisho.db` + write the version sidecar. Retry/resume niceties are out of scope; a failed download deletes the temp file and surfaces a retryable error (the existing lazy-open already supports retry on next search).
- **Precedence stays:** bundled dev copy (F5) wins when present; the download path only runs in installed contexts.

**Testing:** unit tests with the mocked `vscode.workspace.fs` + a mocked fetch (happy path, checksum mismatch, network failure). True E2E needs the data release to exist — see item 5.

**Files:** `src/host/ensureDatabase.ts` (+ tests), possibly a small `src/host/download.ts`.

## 3. In-app credits / attribution view

EDRDG attribution is a license obligation and must be visible in the product, not just the README. A lightweight "About" view in the webview: reachable from the search view (small ⓘ affordance), rendered from a new `getAbout` message that returns the DB `meta` rows (source, dictDate, revisions, license, wordCount, builtAt) plus static credits (JMdict/EDRDG link+license, wanakana, data via jmdict-simplified). Navigation machine gains an `about` view (the stack design absorbs it).

**Files:** `src/shared/messages.ts` (+`getAbout`), `src/host/db.ts` (meta read), `src/extension.ts` (route), `src/webview/views/About.tsx` (+ css), `src/webview/machines/navigation.ts`, `App.tsx`.

## 4. Per-platform packaging + release workflow repair

- **Fix the stale repo guard** in `.github/workflows/release.yml`: it still checks `github.repository == 'Saeris/vscode-extension-template'`, which silently skips publishing on this repo.
- **Platform matrix:** each `.vsix` must contain exactly its platform's `@tursodatabase` native binary, so build on native runners (windows-latest, macos-latest arm64, macos-13 x64, ubuntu-latest, ubuntu-24.04-arm) with `vsce package --target <platform>`; publish each with `vsce publish --packagePath`. How this composes with Bumpy's `buildCommand`/`publishCommand` single-runner flow is the milestone's main CI unknown — investigate Bumpy's multi-artifact support during implementation; worst case the bumpy publish step triggers a separate matrix workflow.
- Local `vp run build` keeps producing the current-platform `.vsix` for manual testing.

## 5. Publish handoff (user actions)

Things only the repo owner can do, in order:

1. **Push `main`** (currently ahead of origin) so CI/Bumpy see M1–M3 work.
2. **Create the data release:** `vp run build:data:full`, then `gh release create dictionary-latest assets/jisho-full.db.gz assets/jisho-full.db.gz.sha256 --title "Dictionary data" --notes "Rolling JMdict database"` (exact commands land in the README).
3. **Wire secrets:** `VSCE_PAT`, `OVSX_PAT`, `BUMPY_GH_TOKEN` repo secrets (README's one-time setup section documents each).
4. **Merge the Bumpy version PR** once green — first automated publish.

## Verification

- Item 1: full build completes; size/latency numbers recorded here as as-built notes; existing 38 tests still pass against the common fixture.
- Item 2: unit tests for download/checksum/failure paths; then a real E2E — uninstall dev copy, install the packaged `.vsix`, confirm first-run download → working offline search.
- Item 3: About view renders real meta in F5; EDRDG link + license text present.
- Item 4: CI matrix produces 5 `.vsix` artifacts, each containing only its platform's turso binary (inspect the zips in CI logs).
- Standing gate: `vp check` clean, `vp test` green after each item; one commit + bump file per item.

## As-built deviations

Where the shipped implementation differs from the plan above:

- **The latency gate failed and forced a search rework.** At full scale (~3M term rows), unanchored `LIKE '%…%'` scans took 430–530ms typical and 3.2s worst-case. Rather than adopt Turso's experimental `fts_match`, matching became entirely index-backed: gloss _words_ and CJK _characters_ are indexed as their own term rows at build time, and the query is a single index range scan with CASE-tiered scoring. Re-measured at 2–75ms (20–60×). Trade-offs: mid-word kana substring matches dropped (prefix + deinflection cover real usage); the full DB grew 217→320MB (gz asset 91→132MB).
- **The bulk import needed batched commits.** One giant transaction let the WAL balloon past 5GB (it can never checkpoint mid-transaction); committing every 5k words with per-batch `wal_checkpoint(TRUNCATE)` keeps it bounded. Full build: ~4m14s.
- **No CI matrix after all.** The turso platform binaries are prebuilt npm packages, so `scripts/package-platforms.ts` builds all targets from one machine by swapping registry tarballs into node_modules — composing with Bumpy's single-runner flow unchanged (the plan's "main CI unknown" dissolved).
- **darwin-x64 is unsupported:** turso 0.6.1 ships no Intel-Mac binary. Four targets ship: win32-x64, darwin-arm64, linux-x64, linux-arm64. The packaging script validates targets against turso's optionalDependencies so an upgrade that changes the lineup fails loudly.
- **Download retry is lazy, not resumable:** a failed download deletes its `.part` file and surfaces a retryable error via the existing lazy-open path, as planned; no resume support.
