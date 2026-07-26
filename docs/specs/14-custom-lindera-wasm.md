# Spec 14 — A custom lindera-wasm build we own

**Backlog:** follows spec 13 §B (slang coverage). **Status:** SPIKE / SCOPING — the build path is investigated (2026-07-26); this lays out what we'd own, the effort, and the sequence, for sign-off before standing up a Rust toolchain in CI.

## TL;DR — the clean architecture (settled 2026-07-26, after two detours)

**Upgrade to lindera-wasm 4.x, build the plain WASM (no `embed-*` feature), and load the dictionary from BYTES at runtime.** Two facts, both verified against the real crates:

1. **`embed-ipadic` is the entire source of the toolchain pain.** It downloads+compiles IPADIC into the WASM at build time, dragging in `lindera-dictionary → reqwest → rustls → aws-lc-sys`, which on `wasm32` (no pre-generated bindings) wants NASM + CMake + libclang — gigabytes of C/C++ toolchain to compile a *build-time TLS client that ships in nothing*. Build WITHOUT any `embed-*` feature and `cargo tree` shows **`reqwest` and `aws-lc-sys` gone entirely** (confirmed on both 2.0.0 and 4.0.1). The plain WASM builds in **~5 s, is ~2 MB** (vs 13.5 MB embedded — the 11 MB delta IS the dictionary), with **zero native toolchain**.

2. **BUT the runtime-bytes loader only exists on lindera-wasm 4.x — NOT the 2.0.0 the npm package pins.** Our `lindera-wasm-nodejs-ipadic@2.0.0` WASM (`src/lib.rs`) exposes only `setDictionary(uri)` (embedded:// or an unreachable path) and `setUserDictionary(path)` — no way to feed a dictionary at runtime. The docs I kept reading (`loadDictionaryFromBytes`, `setDictionaryInstance`, `build_user_dictionary`) describe the **4.x** API. lindera/lindera-wasm are at **4.0.1** (2026-07-18); confirmed 4.0.1's `src/lib.rs` has `load_dictionary_from_bytes`, `load_user_dictionary`, `build_dictionary`, `build_user_dictionary`. **This is what makes the clean path real** — on 4.x we get the tiny dictionary-free WASM AND a supported bytes loader AND first-class user dictionaries.

**The plan:** move to a custom build of lindera-wasm 4.x (no embed) → produce IPADIC (+ our slang) as dictionary bytes once via `build_dictionary`/CLI → bundle the bytes → at runtime `load_dictionary_from_bytes` + build the tokenizer. No embed, no reqwest, no aws-lc, no NASM/CMake/clang, no crate patches. `tokenizer.ts`'s `getTokenizer()` changes from `setDictionary("embedded://ipadic")` to loading our bundled bytes; everything downstream (`segment()`, the tests) is unchanged.

### Two detours, recorded honestly

- **The `ring`-patch route (below) was over-engineered.** It made `embed-ipadic`'s build-time download succeed with a light (NASM-only) toolchain via a two-crate Cargo `[patch]` — but the download shouldn't happen at all. Solved the wrong problem well.
- **"Just drop `embed-ipadic`" (my first correction) was right in spirit but wrong on version** — on the pinned 2.0.0 there's no bytes API to receive the dictionary, so a plain 2.0.0 WASM can't tokenize anything. The version bump to 4.x is the missing piece.
- Simpler `embed` fallbacks, if we ever DID embed: `AWS_LC_SYS_NO_ASM=1` / `AWS_LC_SYS_PREBUILT_NASM=1` (prebuilt asm, no NASM), `LINDERA_DICTIONARIES_PATH` (pre-cached, offline). The user's instinct that gigabytes of tooling couldn't be necessary was correct.

## Intent (the user's framing)

Not merely "embed a slang dictionary." Own the tokenizer build so we can: (1) bake in a **user dictionary** (slang IPADIC lacks — きもい, うざい — plus any domain words), (2) **drop what we don't use** (Korean/Chinese dictionaries, filters we never call), and (3) move tokenizer-adjacent logic that currently lives in TypeScript (`segment()`'s POS map, サ変-coalescing, suffix folding, and the honorific/reading heuristics) **into Rust**, where it's closer to the lattice and faster. Explicitly acceptable to the user: taking on Rust development and maintenance. Explicitly NOT a full fork — we still consume the upstream `lindera` crates, and we can **drop this layer entirely if Lindera v5 solves user dictionaries upstream**.

## What the investigation established (2026-07-26)

- **`lindera-wasm` is a thin wasm-bindgen wrapper** (crate 2.0.0) over the `lindera` core crate (2.0.1). `src/lib.rs`'s `TokenizerBuilder` delegates: `setDictionary` → `set_segmenter_dictionary(uri)`, `setUserDictionary` → `set_segmenter_user_dictionary(uri)`. Small surface — a few hundred lines — so a fork or a thin dependent crate is realistic.
- **Build is standard:** `wasm-pack build --release --features=embed-ipadic --target=bundler` (features: `embed-ipadic|unidic|ko-dic|cc-cedict|cjk`, `default = []`). We'd build `embed-ipadic` ONLY — dropping the CJK bloat the off-the-shelf `nodejs-ipadic` package already avoids, but confirming we're minimal.
- **User dictionaries are fully supported by Lindera core** — the off-the-shelf package's `setUserDictionary(path)` fails only because its WASM IO isn't wired for host paths (spec 13 §B). In our own build we control that: either compile the user dict to binary and **embed it at build time** (like the main dict), or add a wasm-bindgen method that **takes CSV/bytes directly** and calls the core's user-dictionary builder in memory. Both avoid the file-IO problem entirely.
- **Current footprint:** the shipped `lindera_wasm_bg.wasm` is 13 MB (IPADIC embedded). Our integration is already clean — the `.js` loads the `.wasm` via `__dirname` + `fs.readFileSync`, kept unbundled by one `.vscodeignore` line (`!node_modules/lindera-wasm-nodejs-ipadic/**`) and a `vite.config` external. A custom build drops in the same seam: same load pattern, we just point at our package.

## Options for HOW we own it (pick during build)

1. **Fork `lindera-wasm`** — clone the crate, add an `embed-user-dictionary` build step (compile our CSV → binary, `include_bytes!` it) and/or a `setUserDictionaryFromBytes(Uint8Array)` bindgen method. Most control; we maintain a small Rust crate.
2. **Thin dependent crate** — a new crate that depends on `lindera-wasm` (or directly on `lindera`) and re-exports a `TokenizerBuilder` with our additions, without vendoring their source. Less to maintain; depends on how much of their wrapper we need to override (the bindgen methods aren't `pub`-overridable, so this may collapse into #1).

Decide #1 vs #2 when we see how extensible the upstream crate is. Either way we still track upstream `lindera` and can drop the layer if v5 obsoletes it.

## Effort & the real costs (honest)

- **CI toolchain:** a Rust stable toolchain + `wasm-pack` + the `wasm32-unknown-unknown` target in the build workflow. This is the genuine new cost — a compiled-language build step in a project that's been pure TS/WASM-consumer. Cache the Cargo registry + target dir or it's slow.
- **Artifact:** the built `.wasm` + generated `.js`/`.d.ts` become OUR package (vendored in-repo or a small workspace crate built in CI). It ships the same way the current one does.
- **Per-platform packaging:** the tokenizer WASM is platform-INDEPENDENT (unlike the `@tursodatabase` native binary), so the per-platform VSIX matrix (spec 05 C) is unaffected — one WASM for all targets.
- **Risk:** a build we own can drift from upstream; mitigated by pinning `lindera` and keeping our delta minimal. Bundle size should DROP (ipadic-only, no CJK) or hold; measure.

## Recommended sequence (each a checkpoint)

1. **Spike the build locally** — clone `lindera-wasm`, `wasm-pack build --features=embed-ipadic`, drop the artifact into our `node_modules`/seam, confirm `segment()` still tokenizes identically (the corpus snapshot test + accuracy gate are the oracle). Proves the toolchain before any CI or feature work. **No merge until this is green.**
2. **Embed a user dictionary** — add きもい/うざい/etc. (curated, each with a corpus regression), rebuild, confirm they tokenize as one segment. This delivers spec 13 §B properly.
3. **Wire the CI build** — the Rust/wasm-pack step, cached; the built package as a workspace artifact. Gate the release on it.
4. **(Later, optional) migrate TS logic into Rust** — move `segment()`'s POS map / coalescing / folding into the wrapper, so the JS side gets clean segments. Only after 1–3 are stable; each move validated against the existing tokenizer tests. This is where "move it out of TypeScript" pays off, but it's the least urgent step.

## Spike findings (2026-07-26 — build attempted locally)

The toolchain is present (Rust 1.93, cargo, wasm-pack 0.9.1, `wasm32-unknown-unknown`). `git clone lindera/lindera-wasm` (2.0.0), then `wasm-pack build --release --target=nodejs -- --features=embed-ipadic`. Result: **build FAILS with one specific, diagnostic error** —

```
aws-lc-sys ... panicked: NASM command not found or failed to execute
Error: Compiling your crate to WebAssembly failed (cargo exited 101)
```

Traced (`cargo tree -i aws-lc-sys`): `aws-lc-sys` ← `aws-lc-rs` ← `rustls` ← `reqwest` ← **`lindera-dictionary` (BUILD-dependency of `lindera-ipadic`)**. The `embed-ipadic` feature turns on `lindera-dictionary`'s `build_rs` feature (`build_rs = ["dep:reqwest"]`), which uses `reqwest` **at build time to DOWNLOAD the IPADIC source**. reqwest selects the `__rustls-aws-lc-rs` TLS backend, and `aws-lc-sys` compiles x86 asm that needs **NASM**. None of this ends up in the WASM — it's purely the build-time dictionary fetch.

**So the build is VIABLE but has a real prerequisite the off-the-shelf story hides: a NASM assembler (and a build-time network fetch of IPADIC).** Three ways forward, in order of cleanliness:

1. **Install NASM** (scoop/choco locally, `ilammy/setup-nasm` in CI) — smallest change, unblocks immediately, but adds NASM + a build-time download to the toolchain. Verify the produced WASM works before optimizing.
2. **Force reqwest's `ring` TLS backend** instead of aws-lc-rs — drops the NASM requirement, but needs overriding how `lindera-dictionary` declares reqwest (a patch/fork of the dep graph, or a Cargo `[patch]`). More work, cleaner result.
3. **`LINDERA_DICTIONARIES_PATH`** — point the build at a pre-downloaded IPADIC dir to skip the *download*; but `reqwest` is still COMPILED (feature is on), so aws-lc/NASM is still required unless combined with #2. Useful for reproducible/offline CI, not a standalone fix.

Recommended spike path: #1 to prove end-to-end (build → drop into our seam → corpus/accuracy oracle green), then consider #2/#3 to trim the toolchain. **The NASM + build-time-download requirement is a CI cost to weigh** — this is the concrete finding the spike was for.

### Update (2026-07-26, continued) — the aws-lc chain wants a FULL native C toolchain

Installing NASM got past the first error; the build then demanded **CMake** ("Missing dependency: cmake"), and after CMake it needs a **C compiler** (none of cl/clang/gcc present on this host) — aws-lc-sys builds a native crypto library via CMake. So route #1's true cost is NASM **+ CMake + a C/C++ compiler (MSVC Build Tools, multi-GB, or clang) + Perl**, all on the build host, purely to compile a build-time TLS client that downloads IPADIC and ships in nothing.

This decisively favors **eliminating aws-lc rather than feeding it**:

- **#2 (force `ring`)** is now clearly the better target, but it's not a simple flag: `lindera-dictionary` hardcodes `reqwest = { features = ["rustls"], default-features = false }`, and reqwest 0.13's bare `rustls` feature selects the aws-lc-rs provider. Forcing `ring` needs a workspace-level rustls provider override or a Cargo `[patch]`/fork of `lindera-dictionary` — fiddly, uncertain, but it collapses the whole native chain (ring needs only NASM + a small C stub).
- **Best of all: avoid the build-time download entirely.** If `LINDERA_DICTIONARIES_PATH` points at a pre-fetched IPADIC AND we can compile `lindera-ipadic` WITHOUT its `build_rs`/reqwest feature (or patch it off), reqwest/aws-lc never compile. Needs verifying whether `embed-ipadic` can be satisfied from a local dict without the fetch feature.

**No clean feature-flag escape exists from the lindera-wasm side.** Confirmed: `--no-default-features --features=embed-ipadic` still pulls aws-lc-sys, because `embed-ipadic` → `lindera-ipadic` (dep) unconditionally enables `lindera-dictionary`'s `build_rs` feature (via lindera-ipadic's own default/compress path), and that can't be turned off from the top-level build command — it's baked into how `lindera-ipadic` depends on `lindera-dictionary`. Cutting reqwest/aws-lc therefore requires a Cargo `[patch]` or a small fork of `lindera-ipadic`/`lindera-dictionary`, not a flag.

**Checkpoint:** the "install and finish" path has grown from "install NASM" to one of: (a) install a multi-GB C++ build environment (MSVC Build Tools / clang) so aws-lc-sys compiles; (b) Cargo `[patch]`/fork surgery to force `ring` or drop the fetch feature; or (c) a small fork of lindera-ipadic. All are more than the "install NASM" the route was chosen on, and each is a recurring CI burden. The spike has ANSWERED viability (yes, buildable) and MAPPED the cost (a native crypto build chain for a build-time download). Surfaced for a fresh decision rather than installing a full compiler toolchain or forking crates unilaterally.

**Installed during the spike (local only, reversible):** NASM 3.02 and CMake 4.4.0 via scoop. No C compiler was installed. None of this touched the repo or CI.

### RESOLVED (2026-07-26) — the `ring` patch route WORKS; build succeeds with NASM only

Route #2 (force `ring`) succeeded end-to-end. The recipe, verified:

1. **Vendor-patch `lindera-dictionary`** (its `[dependencies.reqwest]`): change `features = ["rustls"]` → `features = ["rustls-no-provider", "charset", "http2"]`, add an optional `rustls = { version = "0.23", features = ["ring"], default-features = false }`, and extend `build_rs = ["dep:reqwest", "dep:rustls"]`. This drops the aws-lc-rs provider (`cargo tree -i aws-lc-sys` → **GONE**; `ring` appears instead).
2. **Vendor-patch `lindera-ipadic`**: add a `rustls` (ring) build-dependency and, at the top of `build.rs`'s `main()`, `let _ = rustls::crypto::ring::default_provider().install_default();` — because `rustls-no-provider` installs none by default, and the fetch panics `"No provider set"` without it.
3. **`[patch.crates-io]`** in the top crate points both at the vendored copies.
4. **`[package.metadata.wasm-pack.profile.release] wasm-opt = false`** — the emitted WASM uses multiple tables (reference-types), which the pinned wasm-opt rejects (`"Only 1 table definition allowed in MVP"`). The functional WASM is emitted BEFORE wasm-opt; disabling it (or enabling the feature in wasm-opt) is a size nicety, not a blocker.

Result: `wasm-pack build --release --target=nodejs -- --features=embed-ipadic` **succeeds with NASM as the ONLY native prerequisite** — no CMake, no C compiler, no aws-lc. (`ring` itself compiles with NASM + prebuilt objects.) Output is the same 3-file package (`.wasm` 13.5 MB, `.js`, `.d.ts`), same `TokenizerBuilder` API.

**Behavior verified identical (checkpoint 2):** overlaid the custom `.wasm`/`.js`/`.d.ts` onto `node_modules/lindera-wasm-nodejs-ipadic` and ran the oracle — `corpus.spec` snapshots, `tokenizer.spec` invariants, the accuracy gate, and the FULL suite (308 passed / 2 skipped) all green, unchanged. The custom build is a drop-in. Original package restored after.

**What this means for productionizing.** The build needs only: Rust + wasm-pack + `wasm32-unknown-unknown` + NASM (all cheap in CI via `ilammy/setup-nasm`), plus a build-time IPADIC download (or `LINDERA_DICTIONARIES_PATH` for offline/reproducible CI). The two vendored crate patches are tiny (a handful of TOML/one-line-Rust changes) — carry them as an in-repo patch dir with a `[patch.crates-io]`, tracking upstream `lindera` so we can drop them if v5 obsoletes the need. This is a light, maintainable footprint — far from the "multi-GB C++ toolchain" the earlier checkpoint feared. **Viability: confirmed. Remaining work is productionizing (in-repo crate + CI), then embedding the user dictionary (spec 13 §B).**

## Verification

- The corpus snapshot (`corpus.spec.ts`) and the accuracy gate (`accuracy.spec.ts`) are the regression oracle throughout — a custom build must reproduce today's tokenization before it adds anything, then IMPROVE the slang cases without regressing the rest.
- Bundle-size delta measured (expect ≤ current 13 MB, ipadic-only).
- Each user-dict entry has a corpus sentence proving it tokenizes, plus a guard it doesn't mis-fire.
- CI builds the WASM reproducibly; the release gate depends on it.
