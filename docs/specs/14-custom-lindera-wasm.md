# Spec 14 — A custom lindera-wasm build we own

**Backlog:** follows spec 13 §B (slang coverage). **Status:** SPIKE / SCOPING — the build path is investigated (2026-07-26); this lays out what we'd own, the effort, and the sequence, for sign-off before standing up a Rust toolchain in CI.

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

## Verification

- The corpus snapshot (`corpus.spec.ts`) and the accuracy gate (`accuracy.spec.ts`) are the regression oracle throughout — a custom build must reproduce today's tokenization before it adds anything, then IMPROVE the slang cases without regressing the rest.
- Bundle-size delta measured (expect ≤ current 13 MB, ipadic-only).
- Each user-dict entry has a corpus sentence proving it tokenizes, plus a guard it doesn't mis-fire.
- CI builds the WASM reproducibly; the release gate depends on it.
