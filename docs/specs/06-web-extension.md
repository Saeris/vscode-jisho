# Spec 06 — Web extension viability: asset delivery without a filesystem

**Backlog:** new (#40). **Status:** feasibility analysis + plan. **Verdict: viable, not blocked** — but it is a second delivery path for every asset, so do it deliberately, after the first desktop release.

## The question

A web extension (vscode.dev, github.dev, Codespaces browser) runs in a **Web Worker**, not Node. There is no `fs`, no `child_process`, no native addons. Everything this extension's host layer does today — open a SQLite file, read SVGs from `extensionUri`, gunzip a download — assumes Node. The user's concern was whether that is a blocker, specifically for the bundled SVGs and the database download.

## Verified findings (checked, not assumed)

| Dependency        | Desktop today                                                 | Browser                                                                                                                              | Status                            |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Database engine   | `@tursodatabase/database` (native, `database-win32-x64-msvc`) | **`@tursodatabase/database-wasm` v0.7.0** — "Turso Database for JavaScript in Browser", MIT, same version, published within the week | ✅ exists                         |
| Persistence       | file in `globalStorage`                                       | **OPFS** — `Opfs`/`OpfsFile` exports; `connect()` "pre-opens necessary files in the OPFS"                                            | ✅ exists                         |
| Tokenizer         | `lindera-wasm-nodejs-ipadic`                                  | **`lindera-wasm` / `lindera-wasm-ipadic` v2.1.0** — "morphological analysis library for WebAssembly"                                 | ✅ exists                         |
| Stroke SVGs       | files in the .vsix, read with `workspace.fs`                  | `vscode.workspace.fs` + `extensionUri` **work in web** (it is the VS Code FS API, not Node's)                                        | ✅ works as-is                    |
| Download + gunzip | `node:fs`, `node:zlib`, `node:crypto`                         | `fetch` + `DecompressionStream("gzip")` + `crypto.subtle.digest`                                                                     | ✅ web-standard equivalents exist |

**Known risk, and why it does not block us:** turso's own test suite documents an OPFS/WASM **insert hang** (`core/io/memory_yield.rs::wasm_opfs_cache_spill_insert_hang`) — mid-transaction cache spilling blocks instead of yielding, because on the browser main thread OPFS completions only arrive when control returns to the JS event loop. That is a **write-path** bug. Our browser workload is **read-only** (the DB is downloaded, then queried), so we do not hit it — but the seeding step (writing the downloaded bytes into OPFS) must avoid one big transaction. Prefer writing the file to OPFS directly (`FileSystemWritableFileStream`) and _opening_ it, rather than INSERTing rows.

## The real constraint: size, not capability

The blocker is not "can it run" — it is **~400 MB of database in browser storage**:

- OPFS quota is per-origin and browser-managed (Chrome: a share of free disk; Safari: much stingier, historically ~1 GB with prompts). A 400 MB write can be evicted or refused.
- vscode.dev users are often on transient/low-bandwidth sessions; a 129 MB download to _start using a dictionary_ is hostile there in a way it is not on desktop.

**Therefore the web build should ship a different data tier**, not the same one:

1. **Common-subset DB** (the existing `--common` variant — 51 MB raw, 21 MB gzipped, 22k entries). It already exists as the dev/test fixture and covers ordinary lookups.
2. **Full DB as an explicit opt-in** ("Download full dictionary — 129 MB") for users who want it and have the quota.
3. **Names DB: not offered in web** initially (409 MB is untenable in OPFS).

This is a feature-tier decision, not a compromise: it also fixes the "first run is a 129 MB download" problem that exists on desktop.

## Architecture

The host layer is Node-shaped throughout, so the work is **extracting a platform seam**, not rewriting features.

- `package.json` gains `"browser": "./dist/extension.web.js"` alongside `"main"`. VS Code picks per environment.
- Split the host into platform-agnostic logic and two thin backends:
  - `src/host/platform/node.ts` — today's `fs`/`zlib`/`crypto` implementations.
  - `src/host/platform/web.ts` — `fetch` + `DecompressionStream` + `crypto.subtle` + OPFS.
  - Everything else (`db.ts` queries, `hover.ts`, `spacing.ts`, `furigana.ts`, the whole webview) is already platform-free and moves unchanged. `ruby.ts`, `conjugate.ts` and friends are pure.
- `Dictionary.open` takes an injected connection factory so the engine (native vs WASM) is a parameter, not an import.
- The `vp pack` config gains a second entry with browser conditions; the WASM assets must be _bundled_ (a web extension cannot read `node_modules` at runtime).

**What must NOT change:** the stroke SVGs stay bundled and keep using `vscode.workspace.fs` — that API works in web, so #31's single-delivery-path decision holds in both environments. This is the direct answer to the user's SVG concern: **no change needed**.

## Sequencing (why this is not next)

1. Desktop release first (spec 05 is the blocker there).
2. Then the platform seam — mechanical, and it improves the desktop code by removing incidental Node coupling from the query layer.
3. Then the web backend behind an experimental flag, tested on vscode.dev with the common subset.

Doing it before the desktop release would mean maintaining two unproven delivery paths at once.

## Open questions

1. **Is web support a goal for v1.x at all**, or a "nice someday"? It roughly doubles the delivery surface; the answer determines whether the platform seam is worth extracting early (it is cheap now, expensive after more host code accretes).
2. **Common-subset-only in web, or offer the full download?** Recommendation: ship common, offer full behind an explicit action.
3. **Handwriting recognition** (`patterns.data.ts`, 1.7 MB) and the 12 MB tokenizer WASM both need bundling into the web build — acceptable, but they set a floor on the web extension's own size.

## Out of scope

Sync/cloud-hosted databases (turso offers them; it would make the extension network-dependent, against the offline-first principle); a service worker cache layer; supporting browsers without OPFS.
