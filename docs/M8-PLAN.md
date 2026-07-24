# Milestone 8 Plan — Web extension (vscode.dev)

> **Status:** planned. Make the extension run in web-based VSCode (vscode.dev / github.dev), where the extension host is a Web Worker. Read [CONVENTIONS.md](CONVENTIONS.md) first. The 2026-07 spike findings below are settled facts — don't re-derive them.

## Context (spike findings, verified 2026-07)

- **[@tursodatabase/database-wasm](https://github.com/tursodatabase/turso/tree/main/bindings/javascript) is browser-only.** Its entry `fetch()`es its `.wasm` asset (fails under Node's file:// fetch) and its storage backend is **OPFS**. It therefore _complements_ the native per-platform packages for a web host; it cannot replace them for the desktop host. Same better-sqlite3-shaped async API as the native package (both wrap `@tursodatabase/database-common`), so `Dictionary` should port with minimal changes.
- The Node-WASI build (`@tursodatabase/database-wasm32-wasi`) is **abandoned upstream** (0.1.4 vs 0.6.1) — not a viable "one WASM everywhere" path.
- The webview is already pure browser code and needs nothing. Only the **host** needs a second build.

## 1. Feasibility spikes (gate — do first, in a real vscode.dev session)

Build a throwaway web extension (or a stripped branch of this one) and answer:

- **WASM loading in the web extension host:** can the worker instantiate database-wasm's module under vscode.dev's CSP? (VSCode web extensions support WebAssembly, but verify with _this_ package's loader — its `./bundle` export condition inlines the wasm for bundlers and is the likely path.)
- **SharedArrayBuffer / cross-origin isolation:** database-wasm's OPFS layer wants SAB. Is the vscode.dev extension-host worker cross-origin isolated? (Check `crossOriginIsolated` there; also github.dev.) If not, does the package degrade (sync OPFS access handles in a worker may suffice without SAB) or hard-fail? This is the likeliest killer — find out early.
- **OPFS quota + write throughput:** a ~320MB DB (item 3 may shrink this). Measure `navigator.storage.estimate()` in the host worker and time writing 300MB+ into OPFS.
- **Latency:** load the full DB in the wasm engine and re-run the latency probe (native budget <150ms, currently 2–75ms; WASM overhead expected ~1.5–3×, which still fits — verify).

**If SAB/OPFS blocks:** record findings, park the milestone, and file an upstream issue — the engine seam (item 2) is still worth landing for testability, but don't build delivery against a broken foundation.

## 2. Engine seam + dual host build

- Introduce `#turso` via package.json `imports` (or a build-time alias in `vite.config.ts`): the Node build resolves `@tursodatabase/database`, the web build `@tursodatabase/database-wasm`. `Dictionary` and everything above it stay engine-agnostic (they already only use `connect`/`prepare`/`all`/`get`/`exec`/`close`).
- Second host bundle: tsdown target `dist/extension-web.js` (ESM/webworker platform, wasm inlined via the `./bundle` condition or emitted as an asset the loader can reach); manifest gains `"browser": "./dist/extension-web.js"` (removed in M1 precisely to re-add here). `vscode` stays external; turso-wasm gets bundled (there's no node_modules at web runtime).
- CI/packaging: web support ships in the _same_ extension version; `vsce package --target web`? — no: web-enabled extensions are declared by the `browser` field within the existing packages; verify how per-platform `.vsix` + `browser` interact (platform-specific packages with a browser entry are allowed; the web host ignores the native deps). Confirm against vsce docs during implementation.

## 3. Web delivery: OPFS `ensureDatabase` backend

- Abstract `ensureDatabase`'s storage side: Node path (current, unchanged) vs web path — download `jisho-full.db.zst` from `dictionary-latest`, decompress, write into OPFS, then `connect()` by OPFS name.
- **Decompression (the zstd cost, tied to the E decision):** the release artifacts are zstd (`.zst`), but the web `DecompressionStream` standard supports only `gzip`/`deflate`, NOT zstd — so the web path needs a small WASM zstd decoder (e.g. `fzstd`, ~30 KB) instead of `DecompressionStream`. The Node host never does (Node 26's `node:zlib` decodes zstd natively). This is the one documented consequence of choosing zstd for the ~29% smaller artifacts; web is deferred anyway.
- **Integrity:** WebCrypto's `crypto.subtle.digest` is one-shot (no streaming); hashing 132MB means holding the compressed buffer in memory once — acceptable, but measure in the worker; if memory-tight, use a small streaming-sha256 JS implementation instead. Reuse the `.version` sidecar convention (stored as an OPFS file or `Memento`).
- **Size lever (evaluate during the milestone):** a web-targeted DB could drop the biggest tables (e.g. ship common-only + on-demand full) if quota or download UX demands it — decide with item 1's quota numbers, and note M6's separate-names-artifact precedent for multi-artifact delivery.
- Progress UI: `withProgress` works identically in web hosts.

## 4. Web-specific regressions pass

Run the whole feature surface in vscode.dev: search (all script routes), detail views, About, deinflection, and whatever M4–M7 features exist by then. Web-delivery wrinkles flagged in their plans — audit here: the **Lindera tokenizer** already has a `lindera-wasm-web-*` build (M5 chose it partly for this), but it needs the **`wasm-unsafe-eval` CSP** in the web host — confirm that's grantable in the vscode.dev extension worker; and KanjiCanvas/AnimCJK assets need their own web delivery. Fix or explicitly document gaps (a partial web release with e.g. handwriting disabled is acceptable if labeled).

## Build order & verification

1 (spikes — gate, record all numbers) → 2 (seam + dual build) → 3 (OPFS delivery) → 4 (regressions pass). Per-item commits + bump files (the milestone ships as one `minor` user-facing change: "works on vscode.dev"). Standing gates per CONVENTIONS plus: the Node/desktop path must show **zero** behavior change (full existing test suite + a desktop F5 pass after the seam lands). Append as-built + flip ROADMAP status.
