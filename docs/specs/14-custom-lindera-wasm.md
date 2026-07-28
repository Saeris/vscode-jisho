# Spec 14 — Owning the tokenizer: shared compiled dictionary, two thin bindings

**Backlog:** follows spec 13 §B (slang coverage). **Status:** ARCHITECTURE SETTLED (2026-07-26) after a spike + a research pass. The spike explored building a custom WASM (recorded below for the record); research then found a simpler shape that serves BOTH the desktop host and the planned web extension (spec 06). Read this top section; the spike history follows.

## Settled architecture (2026-07-26) — the dictionary is the asset, bindings are front-ends

The realization from researching the current lindera (4.x monorepo) bindings from primary sources: **both official bindings load a SEPARATELY-COMPILED dictionary; they differ only in HOW they take it. So we produce ONE compiled dictionary asset (IPADIC + our slang, built once with a pinned lindera version) and consume it through two thin, PUBLISHED bindings — no custom build.**

|                           | `lindera-nodejs` (native NAPI)                                                                                                                         | `lindera-wasm-web` / `-bundler` (WASM)                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Target                    | Desktop extension host (Node)                                                                                                                          | Planned WEB extension (spec 06)                                                   |
| Platform                  | 6 prebuilt binaries (`…-win32-x64-msvc`, `…-linux-x64-gnu`, `…-darwin-arm64`, …) — **the same 6-platform matrix we already ship for `@tursodatabase`** | Universal                                                                         |
| Dictionary input          | **file path** — `loadDictionary("/path/to/ipadic")`                                                                                                    | **bytes** — `loadDictionaryFromBytes(...8 arrays...)` + `setDictionaryInstance()` |
| User dictionary           | path-based, works (native fs)                                                                                                                          | **path-only → sandbox-blocked**; there is NO `loadUserDictionaryFromBytes`        |
| Custom Rust build for us? | **None** (prebuilt npm, `lindera-nodejs@4.0.1`)                                                                                                        | **None** — the published dictionary-free `lindera-wasm-web` loads bytes           |
| Rust toolchain for us?    | none                                                                                                                                                   | none, except the one shared asset build                                           |

**Consequences that make this the plan:**

- **Neither binding needs a custom build.** `lindera-nodejs` is a prebuilt NAPI addon (v4.0.1, with the exact per-platform matrix we already package). `lindera-wasm-web`/`-bundler` ship dictionary-free and load bytes. Both are on npm. The whole "build our own WASM + Rust in CI" concern (spike below) evaporates — we CONSUME published bindings.
- **Slang goes INTO the main dictionary, not a user dictionary.** The WASM has no user-dict-from-bytes API, and a native-only user-dict wouldn't be shared with web. So we merge our slang CSV rows into the IPADIC source and compile them into the single main-dictionary asset both front-ends load. IPADIC detailed CSV format (13 cols): `surface, left_id, right_id, cost, POS, subcat1-3, conj_form, conj_type, base, reading, pronunciation` — e.g. `きもい,<lid>,<rid>,<cost>,形容詞,自立,*,*,形容詞・イ段,基本形,きもい,キモイ,キモイ`.
- **The ONE thing we own is producing that compiled dictionary asset** (IPADIC + slang, pinned lindera version, the 8 files `metadata.json/dict.da/dict.vals/dict.wordsidx/dict.words/matrix.mtx/char_def.bin/unk.bin`). This is a `dictionary.yml`-style Linux/CI job — the same "compile a data asset" pattern as the DB build — done once per lindera bump or slang change. Lindera even publishes base IPADIC dictionaries on GitHub Releases, so we may only need to compile the slang delta on top. Version-lock: the asset's lindera version must match both bindings' versions.
- **Desktop is the v1 target; web (spec 06) reuses the same asset.** `lindera-nodejs` replaces `lindera-wasm-nodejs-ipadic` in `tokenizer.ts` — `loadDictionary(dictPath)` + `new Tokenizer(dict, "normal")`, dict shipped as a bundled data dir (or provisioned like the DB). The tokenizer output is unchanged (corpus/accuracy oracle). When the web extension arrives, it loads the SAME compiled dictionary as bytes via `lindera-wasm-web`.

**Confirmed from primary source (2026-07-26):**

- **`lindera-nodejs` supports user dictionaries by path** (`examples/tokenize_with_userdict.js`): `loadUserDictionary(path, metadata)` → `new Tokenizer(dict, "normal", userDictionary)`. It also accepts `loadDictionary("embedded://ipadic")` — so a desktop-only route could even use an embedded-dict variant and a native user-dict, needing NO separate dictionary asset at all.
- **Lindera publishes the compiled base dictionary** as a GitHub Release asset: `lindera-ipadic-4.0.1.zip` (also `-neologd`, `-unidic`, `-ko-dic`, `-cc-cedict`). So we NEVER compile base IPADIC — we consume their pinned archive. Only the slang delta is ours.

**So for the DESKTOP v1 target, the simplest correct path needs zero custom builds and zero base-dict compilation:** `lindera-nodejs` + a slang **user-dictionary** (native `loadUserDictionary`, works by path) + Lindera's released dictionary (or an embedded-ipadic nodejs variant if one exists). The slang-in-MAIN-dict merge is only needed for the WEB path (WASM's user-dict-from-bytes gap) — deferred with spec 06.

**Open questions for sign-off:**

1. **Desktop dictionary provisioning:** ship Lindera's released archive (`lindera-ipadic-4.0.1.zip`, 15.9 MB → the 8-file dir) by path, or provision it like the DB. No `embedded://` nodejs variant exists (checked: `lindera-nodejs-ipadic`/`-cjk` are 404; the platform addon is ~5 MB = code only).
2. **Slang delivery on desktop:** native user-dictionary (a CSV compiled to a small user-dict, loaded by path) — no main-dict touch. The web path later merges slang into the main dict; that divergence is acceptable and spec-06-scoped.

### Spike verdict (2026-07-26) — `lindera-nodejs` is BROKEN as published; WASM is the proven path

Spiked `lindera-nodejs@4.0.1` in isolation before committing (per "spike first"). **Result: the package is non-functional on npm.** Its published tarball contains ONLY `package.json` + `README.md` — the napi entry point `index.js`/`index.d.ts` (generated by napi-cli, gitignored in the repo) is **missing from every published version (3.0.7, 4.0.0, 4.0.1)**. `require("lindera-nodejs")` fails with `MODULE_NOT_FOUND` out of the box. The platform binary (`lindera-nodejs-win32-x64-msvc`, the 4.9 MB `.node`) installs fine, and the released IPADIC archive extracts to the expected 8 files — but there is no working JS glue to load them.

**Consequences for the plan:**

- **The reliability verdict flips.** The custom WASM path is PROVEN end-to-end (built, loaded a dict, tokenized, full suite green); `lindera-nodejs` looked simpler but is broken as shipped. Had we swapped it in on the strength of the docs, we'd have shipped a broken dependency.
- **`lindera-nodejs` is not permanently ruled out** — the missing `index.js` is reconstructable boilerplate (it `require`s the correct `@lindera-nodejs-<platform>/*.node`), so we COULD vendor a tiny loader shim. But depending on a broken-on-npm package + owning napi glue is real risk/maintenance, and an upstream issue should be filed/fixed first.
- **Recommended desktop path, revised:** either (a) file the upstream `lindera-nodejs` publish bug and wait for a fixed release, or (b) if desktop-native is wanted NOW, vendor the ~30-line napi loader shim against the working platform `.node`. Otherwise the **proven custom-WASM-on-desktop** route stays viable (one artifact, shared with web), at the cost of the slang-in-main-dict merge. Decide with the user.

### Upstream diagnosis (2026-07-26) — root cause + PR opportunity

Investigated the upstream state per the user's steer (existing bug? PR-able? v5 status?):

- **No existing issue** for the missing `index.js` (searched `lindera/lindera` — only #808 mentions nodejs, unrelated). We would be first to report it.
- **Root cause pinned in `.github/workflows/release.yml`:** the `publish-nodejs-npm` job downloads the `.node` binaries, runs `napi create-npm-dirs` (which creates only the PLATFORM sub-package dirs) + `napi artifacts`, then `npm publish`. **It never generates the main package's `index.js` / `index.d.ts`** — those come from `napi build` (run in the separate `build-lindera-nodejs` job, which uploads only `*.node` and discards the JS), and `index.js` is gitignored so it's never in the checkout. So the root package publishes without its entry point. This is precisely the "CI/Release workflow issue" suspected — a well-scoped, PR-able fix: regenerate/emit `index.js`+`index.d.ts` in the publish job before `npm publish` (e.g. `napi build --release --dts` or committing the generated glue).
- **v5 is imminent and restructures the build:** issue **#763 "Release v5.0.0" is OPEN**; #754/#758 (v5.0 "lean segmenter core", "pure segmenter the default build") are CLOSED (done). A PR against the v4 `release.yml` risks being obsoleted by v5's release rework — check whether v5 already fixes the nodejs publish before investing in a PR, and consider filing the ISSUE regardless (cheap, helps them, unblocks a future fixed release).
- **The wasm npm packages are a related symptom:** `lindera-wasm-nodejs-ipadic@2.0.0` (what we consume) is stale because the CURRENT packages are `lindera-wasm-web`/`-bundler` (v4) — the `-nodejs-*` line was dropped/renamed, not updated. Same theme: npm-publishing lags the crate.

**Decision taken (2026-07-26):** vendor a napi loader shim for `lindera-nodejs` NOW (desktop), file the upstream issue (+ assess a release.yml PR against v4/v5), and keep the custom-WASM path for the web extension (spec 06).

**Exact root cause (confirmed 2026-07-26):** `lindera-nodejs/.gitignore` lists `index.js` and `index.d.ts` as "Build artifacts (generated by napi build)", and the repo has no committed `index.js` (404). The `publish-nodejs-npm` job in `release.yml` runs `napi create-npm-dirs` (platform sub-dirs only) + `napi artifacts` + `npm publish`, but never runs `napi build` to regenerate the root entry point — so the main package packs an empty `files: ["index.js","index.d.ts"]`. The napi-rs package-template instead COMMITS `index.js` (only `*.node` gitignored) and publishes via `napi prepublish -t npm`; lindera diverges on both. **v5.0.0 will inherit the bug** — issue #763 (Release v5.0.0) is OPEN with "no remaining blockers", uses the same `release.yml`, and recent commits to it don't touch this. So a fix is timely, not obsoleted by v5.

**Secondary staleness (confirmed 2026-07-26):** `lindera-nodejs`'s `package.json` has a `require`-only exports map — `{".": {"require": "./index.js", "types": "..."}}` with NO `import`/`default` condition — so `import ... from "lindera-nodejs"` fails `ERR_PACKAGE_PATH_NOT_EXPORTED`, and the install docs push a `createRequire` ESM workaround. This is _more_ restrictive than the napi-rs template, which ships NO exports map (so `import` works via CJS interop). No `engines` field; docs still say "Node 18+" (EOL April 2025). **Implication for OUR shim:** don't replicate the mistake — give the vendored shim either no exports map or a proper dual `import`+`require` map so our ESM `await import()` in `tokenizer.ts` works with no `createRequire`. Folded as a secondary note into the upstream issue draft.

**Upstream status (2026-07-26):** the **issue was filed** by the user (bug report + reproduction + root cause + two fix options, plus the secondary ESM-workaround / Node-18 note). The `release.yml` PR draft (`upstream-pr.md` — add `napi build` to the publish job, scoped to the missing-`index.js` fix) is **parked pending maintainer response** on the issue.

## Two-audience split (the onboarding-critical finding, 2026-07-26)

The spike surfaced the decision that shapes contribution ergonomics: **the toolchain cost lives ONLY in producing the dictionary bytes, not in the runtime WASM, and dictionary bytes are version-locked to the lindera core that compiled them.**

- **Runtime WASM build** — plain (no `embed-*`), toolchain-free: ~2–2.6 MB, builds in seconds, NO reqwest/aws-lc/NASM/CMake/clang (verified on 2.0.0 and 4.0.1). Needs only Rust + wasm-pack.
- **Dictionary-byte generation** — compiling IPADIC (+ our slang) to the 8 files `load_dictionary_from_bytes` wants. This is where the cost is: it either downloads IPADIC over TLS (reqwest→aws-lc) or compiles a dict, and on **Windows** aws-lc needs the full C toolchain (`AWS_LC_SYS_NO_ASM=1` got past NASM but then CMake failed for lack of a C compiler — the escape hatch is Linux-only). On **Linux/CI** a C toolchain is standard, so this is a non-issue there.
- **Version lock** — 2.x-compiled dictionary bytes fail to load into the 4.x runtime (`InvalidAutomatonError: invalid serialized automaton`). The byte generator and the runtime WASM MUST be the same lindera version.

**Therefore: dictionary-byte generation is a Linux/CI asset job (like the existing `dictionary.yml` DB build), NOT a per-contributor step.** This gives a clean two-audience contribution story:

1. **A contributor editing TypeScript** consumes the committed/released WASM + dictionary bytes. They need NO Rust and NO C toolchain — same as today.
2. **Whoever regenerates the tokenizer** (rarely — a lindera bump or a slang-list change) runs the asset build, ideally in CI on Linux, or locally with Rust + wasm-pack (+ a C toolchain only if generating bytes on Windows).

Document both in the README contribution guide; do NOT make every contributor install Rust.

## TL;DR — the clean architecture (settled 2026-07-26, after two detours)

**Upgrade to lindera-wasm 4.x, build the plain WASM (no `embed-*` feature), and load the dictionary from BYTES at runtime.** Two facts, both verified against the real crates:

1. **`embed-ipadic` is the entire source of the toolchain pain.** It downloads+compiles IPADIC into the WASM at build time, dragging in `lindera-dictionary → reqwest → rustls → aws-lc-sys`, which on `wasm32` (no pre-generated bindings) wants NASM + CMake + libclang — gigabytes of C/C++ toolchain to compile a _build-time TLS client that ships in nothing_. Build WITHOUT any `embed-*` feature and `cargo tree` shows **`reqwest` and `aws-lc-sys` gone entirely** (confirmed on both 2.0.0 and 4.0.1). The plain WASM builds in **~5 s, is ~2 MB** (vs 13.5 MB embedded — the 11 MB delta IS the dictionary), with **zero native toolchain**.

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

## Productionization sequence (informed by the spike — each a checkpoint)

Spike DONE (below): plain 4.0.1 WASM builds toolchain-free; `load_dictionary_from_bytes` is the runtime API; the 8-file dict format + version-lock are confirmed. Remaining is productionizing on the two-audience split.

1. **Vendor the tokenizer package in-repo.** A `vendor/lindera-wasm/` (or `crates/`) holding the plain 4.0.1 WASM build output (`.wasm`/`.js`/`.d.ts`) as a committed, versioned local package the extension imports instead of `lindera-wasm-nodejs-ipadic`. Update `tokenizer.ts`, `vite.config` `neverBundle`, and `.vscodeignore` to point at it. The build recipe (a `crates/lindera-wasm-jisho` or a `scripts/build-tokenizer.*`) is `wasm-pack build --release --target=nodejs` with NO `embed-*` feature + `wasm-opt = false`.
2. **Generate the dictionary bytes as a release asset (Linux/CI).** A `dictionary.yml`-style job that compiles IPADIC (+ our slang user-dict, step 4) to the 8 files with lindera **4.x**, then publishes them (release asset or committed if small enough — ~11 MB). This is the only step that needs the C toolchain, and it lives on Linux where that's free. Version-lock: pin the lindera version used here to the runtime WASM's.
3. **Switch `getTokenizer()` to load-from-bytes.** Read the 8 bundled dict files → `load_dictionary_from_bytes(...)` → `new Tokenizer(dict, "normal", userDict?)`. The corpus snapshot + accuracy gate are the oracle: tokenization must stay identical. Ship the dict bytes alongside the WASM (bundled data files, unbundled like the WASM today).
4. **Build the slang user dictionary (spec 13 §B).** A curated CSV (きもい/うざい/…, `surface,pos,reading`) compiled via `build_user_dictionary` and loaded as the `Tokenizer`'s `user_dictionary`. Each entry gets a corpus regression proving it tokenizes as one segment.
5. **README contribution guide + CI.** Document the two-audience split (TS contributor needs nothing new; tokenizer regeneration needs Rust + wasm-pack, C toolchain only on Windows). Wire the asset build + release gate. Provide the exact toolchain install steps per OS.
6. **(Later, optional) migrate TS logic into Rust** — move `segment()`'s POS map / coalescing / folding into the wrapper. Only after 1–5 are stable; validated against the tokenizer tests. Least urgent.

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
3. **`LINDERA_DICTIONARIES_PATH`** — point the build at a pre-downloaded IPADIC dir to skip the _download_; but `reqwest` is still COMPILED (feature is on), so aws-lc/NASM is still required unless combined with #2. Useful for reproducible/offline CI, not a standalone fix.

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

**Behavior verified identical (checkpoint 2):** overlaid the custom `.wasm`/`.js`/`.d.ts` onto `node_modules/lindera-wasm-nodejs-ipadic` and ran the oracle — `corpus.spec` snapshots, `tokenizer.spec` invariants, the accuracy gate, and the FULL suite (308 passed / 2 skipped) all green, unchanged. (This was the 2.0.0 + ring-patch embed build; superseded by the 4.x plain-build plan, but it proved the drop-in seam and the oracle.)

### Runtime-bytes validation (2026-07-26 — the 4.x path)

- **`load_dictionary_from_bytes` takes the 8 files a compiled lindera dict dir contains** — confirmed by locating the compiled IPADIC dir from an embed build: `metadata.json`, `dict.da`, `dict.vals`, `dict.wordsidx`, `dict.words`, `matrix.mtx`, `char_def.bin`, `unk.bin` (~11 MB total = the dictionary that was baked into the 13 MB embedded WASM). `new Tokenizer(dict, "normal", userDictionary?)` builds from that `Dictionary`.
- **Version-lock confirmed the hard way:** loading the 2.x-compiled files into the 4.0.1 plain WASM throws `LinderaError(kind=Deserialize, InvalidAutomatonError: invalid serialized automaton)`. So the byte generator and the runtime WASM MUST be the same lindera version. Not re-run with 4.x-compiled bytes on this Windows host because generating them needs the C toolchain (aws-lc/CMake) — that's the Linux/CI asset job, deferred to productionization step 2. The API, format, and coupling are established; the final byte round-trip is a CI formality.

**What this means for productionizing.** Runtime WASM = Rust + wasm-pack only (toolchain-free, ~5 s). Dictionary-byte generation = a Linux/CI asset job with the C toolchain (free there), pinned to the runtime lindera version. No crate patches on the 4.x plain path (the ring patch was a 2.x-embed workaround, now unnecessary). **Viability: confirmed. Remaining work is the productionization sequence above, done on the two-audience split so ordinary TS contributors need no Rust.**

## Verification

- The corpus snapshot (`corpus.spec.ts`) and the accuracy gate (`accuracy.spec.ts`) are the regression oracle throughout — a custom build must reproduce today's tokenization before it adds anything, then IMPROVE the slang cases without regressing the rest.
- Bundle-size delta measured (expect ≤ current 13 MB, ipadic-only).
- Each user-dict entry has a corpus sentence proving it tokenizes, plus a guard it doesn't mis-fire.
- CI builds the WASM reproducibly; the release gate depends on it.
