# Spec 06 — Web extension viability: asset delivery without a filesystem

**Backlog:** new (#40). **Status:** feasibility analysis + plan. **Verdict: viable, not blocked** — but it is a second delivery path for every asset, so do it deliberately, after the first desktop release. **Read the stale-premise note below before relying on this verdict:** two of the facts it rests on (the tokenizer being WASM, and the common tier being 51 MB) no longer hold.

## The question

A web extension (vscode.dev, github.dev, Codespaces browser) runs in a **Web Worker**, not Node. There is no `fs`, no `child_process`, no native addons. Everything this extension's host layer does today — open a SQLite file, read SVGs from `extensionUri`, gunzip a download — assumes Node. The user's concern was whether that is a blocker, specifically for the bundled SVGs and the database download.

## Verified findings (checked, not assumed)

| Dependency        | Desktop today                                                                                              | Browser                                                                                                                              | Status                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Database engine   | `@tursodatabase/database` (native, `database-win32-x64-msvc`)                                              | **`@tursodatabase/database-wasm` v0.7.0** — "Turso Database for JavaScript in Browser", MIT, same version, published within the week | ✅ exists                          |
| Persistence       | file in `globalStorage`                                                                                    | **OPFS** — `Opfs`/`OpfsFile` exports; `connect()` "pre-opens necessary files in the OPFS"                                            | ✅ exists                          |
| Tokenizer         | ~~`lindera-wasm-nodejs-ipadic`~~ → **native `lindera-nodejs` 4.x** + an external compiled IPADIC directory | `lindera-wasm` exists but is **far behind the monorepo**, and spec 14 records why we left it                                         | ⚠️ **premise changed** — see below |
| Stroke SVGs       | files in the .vsix, read with `workspace.fs`                                                               | `vscode.workspace.fs` + `extensionUri` **work in web** (it is the VS Code FS API, not Node's)                                        | ✅ works as-is                     |
| Download + gunzip | `node:fs`, `node:zlib`, `node:crypto`                                                                      | `fetch` + `DecompressionStream("gzip")` + `crypto.subtle.digest`                                                                     | ✅ web-standard equivalents exist  |

> **Stale premise (2026-07-29).** This spec's verdict assumed the tokenizer was already WASM, making web a recompile rather than a port. It is not: the tokenizer moved to the native `lindera-nodejs` binding, whose dictionary is a separate ~55 MB directory bundled into the .vsix. The published `lindera-wasm` packages lag the monorepo, and specs 13/14 record the two attempts to use them — the npm packages are broken, a custom build hit a NASM toolchain wall, and v5 still carries the defects. So the tokenizer is now a **second** platform seam of unknown cost, not a solved one, and upstream fixes are a prerequisite. The rest of the analysis (turso-wasm, OPFS, SVGs, download primitives) is unaffected.

**Known risk, and why it does not block us:** turso's own test suite documents an OPFS/WASM **insert hang** (`core/io/memory_yield.rs::wasm_opfs_cache_spill_insert_hang`) — mid-transaction cache spilling blocks instead of yielding, because on the browser main thread OPFS completions only arrive when control returns to the JS event loop. That is a **write-path** bug. Our browser workload is **read-only** (the DB is downloaded, then queried), so we do not hit it — but the seeding step (writing the downloaded bytes into OPFS) must avoid one big transaction. Prefer writing the file to OPFS directly (`FileSystemWritableFileStream`) and _opening_ it, rather than INSERTing rows.

## The real constraint: size, not capability

The blocker is not "can it run" — it is **~400 MB of database in browser storage**:

- OPFS quota is per-origin and browser-managed (Chrome: a share of free disk; Safari: much stingier, historically ~1 GB with prompts). A 400 MB write can be evicted or refused.
- vscode.dev users are often on transient/low-bandwidth sessions; a 129 MB download to _start using a dictionary_ is hostile there in a way it is not on desktop.

**Therefore the web build should ship a different data tier**, not the same one:

1. **Common-subset DB** (the existing `--common` variant — **101 MB raw, 39 MB gzipped**, 22.6k entries; re-measured 2026-07-29, was 51 MB / 21 MB when this spec was written). The Tatoeba example pool doubled it, which weakens the "ship the common subset to web" argument considerably — 39 MB to start using a dictionary on a transient vscode.dev session is a different proposition from 21 MB. Re-decide the tier before building against it: dropping the pool from a web-specific variant is the obvious lever.
2. **Full DB as an explicit opt-in** ("Download full dictionary — 129 MB") for users who want it and have the quota.
3. **Names DB: not offered in web** initially (409 MB is untenable in OPFS).

This is a feature-tier decision, not a compromise: it also fixes the "first run is a 129 MB download" problem that exists on desktop.

## Architecture

> **Measured 2026-07-29 — the seam is much smaller than "Node-shaped throughout" implies.** Across all
> of `src/host` and `src/shared`, exactly **two files import `node:`**: `download.ts` (6 imports) and
> `tokenizer.ts` (2). Four import `vscode`, one import each (`dictionaryUpdate`, `ensureDatabase`,
> `hoverProvider`, `log`). **`db.ts` and `names.ts` import neither** — the whole query layer is
> already platform-free, as are `hover.ts`, `spacing.ts`, `furigana.ts`, `deinflect.ts` and all of
> `shared/`. So the seam is ~8 imports in 2 files plus the engine import, not a layer-wide port. The
> discipline that kept `node:` out of the query layer is holding, so this is not getting more
> expensive with time — which is the argument for NOT extracting it speculatively before M8.

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
3. **Handwriting recognition** (`patterns.data.ts`, 1.7 MB) needs bundling into the web build. The tokenizer's floor is no longer the 12 MB embedded-dictionary WASM this assumed — IPADIC is now an external ~55 MB compiled directory, so a web build must either ship that too or find a smaller dictionary. This is the largest unresolved number in the whole plan.

## Out of scope

Sync/cloud-hosted databases (turso offers them; it would make the extension network-dependent, against the offline-first principle); a service worker cache layer; supporting browsers without OPFS.
