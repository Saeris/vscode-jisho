# Contributing

Thanks for looking. This file covers everything about _building_ the extension; [README.md](./README.md) covers using it.

The project uses [Vite+][viteplus] as a unified toolchain (Oxlint + Oxfmt + tsdown + Vitest) and [Bumpy][bumpy] for versioning and release. [CLAUDE.md](./CLAUDE.md) holds the contribution rules that apply to every change.

## Getting set up

The extension has three build targets: the **extension host** bundle (`vp pack` → a CommonJS `.cjs` VS Code loads in its Node extension host), the **webview** app (`vp build` → the React UI that renders in the sidebar), and a one-off **data build** (`vp run build:data` → the SQLite dictionary). The first two are wired into the F5 debug flow; run the data build occasionally.

```bash
vp install                   # install dependencies
vp run build:data            # download JMdict → build assets/jisho.db (a one-off, ~60s)
vp run build:tokenizer-dict  # download the compiled IPADIC tokenizer dictionary (a one-off)
```

`build:data` downloads the latest [`jmdict-eng-common`][jmdict-simplified] release and compiles it into `assets/jisho.db`. `build:tokenizer-dict` downloads the pinned Lindera IPADIC dictionary the tokenizer loads and copies the slang user-dictionary next to it, into `assets/lindera-ipadic/`. Re-run either only to refresh that data.

Both are **provisioned build artifacts** — not committed, and either bundled into the `.vsix` (the tokenizer dictionary) or downloaded on first activation (the JMdict database). See [Dictionary delivery](#dictionary-delivery).

**No Rust toolchain is needed for ordinary development.** The tokenizer ships as a prebuilt native binary and the dictionary is downloaded already compiled. Rust only matters if the tokenizer binary itself is ever regenerated — see [Tokenizer](#tokenizer).

## Running the extension

Press <kbd>F5</kbd> (Run → Start Debugging). VS Code runs the `build` task and opens a second window titled **[Extension Development Host]** with the extension loaded from this folder.

In that window, click the **Jisho** icon in the activity bar and search for something — `たべる`, `eat`, `食べる`. Because F5 runs from the workspace folder, the extension finds `assets/jisho.db` directly and picks up rebuilds automatically. Installed `.vsix` copies download the full dictionary instead.

To iterate:

- Run the **watch** task once (Terminal → Run Task → `watch`) to rebuild the host and webview on every change.
- Press <kbd>Ctrl</kbd>+<kbd>R</kbd> in the Extension Development Host to load the latest build. Stop debugging with <kbd>Shift</kbd>+<kbd>F5</kbd>.

`vp build` builds the **webview only**. `vp pack` builds the **extension host**. After changing anything under `src/host/` or `src/shared/messages.ts`, run `vp pack` before testing — a stale host answers a new request type with an empty response rather than an error, which reads exactly like a broken query.

## Checks and tests

```bash
vp check --fix   # format + lint + typecheck, with autofixes
vp test --run    # unit and component tests
vp run e2e       # end-to-end tests against a real VS Code
```

`vp check` and `vp test --run` must both be clean before a commit. `vp run e2e` builds both targets first, so it never runs against a stale bundle.

Tests assert **behaviour**, not mechanism, and each carries a `// WHY:` comment tying it to the decision it protects. Two stroke players shipped broken behind green mechanism-asserting suites; that is the reason for the rule.

## Documentation

The README is the Marketplace listing, and its screenshots are generated rather than hand-taken:

```bash
vp run docs:shots   # regenerate the README's screenshots
```

Run it whenever a change touches a documented screen. See the `writing-docs` and `regenerating-screenshots` skills in [.claude/skills/](./.claude/skills/) for the voice, structure and screenshot conventions.

## Bump files

Every user-facing change needs a bump file:

```bash
yarn bumpy add
```

Bump files describe **what a user notices**, not what changed in the code. Read two or three existing ones in [.bumpy/](./.bumpy/) for the voice. Documentation-only changes do not need one.

## Building and packaging

```bash
vp run build   # build both targets and package a .vsix
```

SQLite comes from Node's built-in [`node:sqlite`][node-sqlite], so the database needs no native package. The [Lindera][lindera] tokenizer does: it ships a platform-specific `.node` addon that cannot be bundled, so it is packaged into the `.vsix` from `node_modules`. That is why packaging uses `vsce package --no-yarn` rather than `--no-dependencies`.

Marketplace releases are **per-platform packages**. `vp run build:platforms` builds one `.vsix` per target (Windows x64/arm64, macOS Intel/Apple Silicon, Linux x64/arm64) from a single machine by fetching each platform's prebuilt tokenizer binary from npm — no cross-compilation and no CI matrix. Bumpy's release flow runs the same script and publishes each package.

## Dictionary delivery

The full dictionary (~320MB, ~218k entries) is too large to bundle, so installed extensions **download it on first activation** into global storage: streamed, zstd-decompressed, sha256-verified, with a progress notification. Everything is offline after that. In F5 development the workspace copy of `assets/jisho.db` is used directly.

The download comes from the rolling **`dictionary-latest`** GitHub Release, decoupled from extension releases so dictionary refreshes do not require publishing a new version. To create or refresh it:

```bash
vp run build:data:full   # builds assets/jisho.db + jisho-full.db.zst (+ .sha256, .version)
gh release create dictionary-latest --title "Dictionary data" --notes "Rolling JMdict database" \
  assets/jisho-full.db.zst assets/jisho-full.db.zst.sha256 assets/jisho-full.db.zst.version
# or, to refresh an existing release:
gh release upload dictionary-latest --clobber \
  assets/jisho-full.db.zst assets/jisho-full.db.zst.sha256 assets/jisho-full.db.zst.version
```

The **names dictionary** (JMnedict, ~743k entries) is a separate optional artifact, downloaded on demand the first time a search could return names, and built the same way:

```bash
vp run build:data:names  # builds assets/jisho-names.db + jisho-names.db.zst (+ .sha256, .version)
gh release upload dictionary-latest --clobber \
  assets/jisho-names.db.zst assets/jisho-names.db.zst.sha256 assets/jisho-names.db.zst.version
```

E2E and local development run against the **common** build (`vp run build:data`), which holds ~22,000 words rather than ~218,000. Any headword a test types must exist there, not only in the full build.

## Tokenizer

Japanese word segmentation uses [Lindera][lindera] (MeCab/IPADIC-quality morphological analysis) through its native Node binding. The binding ships as a **prebuilt per-platform binary**, so ordinary contributors need no Rust toolchain. The IPADIC dictionary is not embedded in it: it is a compiled directory provisioned by `vp run build:tokenizer-dict` into `assets/lindera-ipadic/` (gitignored, ~55MB) and bundled into the `.vsix` so the tokenizer works offline.

Pure-kana input tokenizes into garbage — IPADIC needs kanji/kana script transitions to segment — so features skip it rather than act on bad segmentation.

### Adding slang or colloquial words

IPADIC misses some slang (きもい, うざい, エモい), which the lattice otherwise shatters into fragments. A small **user dictionary** layered on IPADIC fixes this: `src/data/slang-userdict.csv`, which is committed. To add a word, follow the format guide in [src/data/slang-userdict.md](./src/data/slang-userdict.md).

**Only add words IPADIC genuinely lacks.** Check by tokenizing them first — most everyday slang is already present in IPADIC 4.x. Add a `corpus.spec.ts` regression, then re-run `vp run build:tokenizer-dict`.

### Regenerating the tokenizer binary

This is rare and needs Rust. The binary is not built here — the prebuilt `lindera-nodejs` is consumed from npm. Only a _custom_ build (a WASM build for a future web extension, say) would bring Rust and `wasm-pack` into the toolchain; the investigation and recipe are in [docs/specs/14](./docs/specs/14-custom-lindera-wasm.md).

The dictionary version is **pinned** to the `lindera-nodejs` package version, because the compiled format is version-locked. Bump both together.

## Stroke-order data

Stroke drawings come from [AnimCJK][animcjk] and live in two directories, because the two sets carry different licences: `assets/kanji-svgs/` (Arphic Public License) and `assets/kana-svgs/` (LGPL v3). Regenerate both with `vp run build:strokes`.

The kana set differs from the kanji set in ways that have broken the shared transform before — implicit-lineto medians with decimal ordinates, and self-crossing strokes split into two clipped fragments. [docs/STROKE-ORDER.md](./docs/STROKE-ORDER.md) records those lessons in full. Read it before touching `scripts/build-strokes.ts`.

## Where things are

| Path           | What                                                    |
| -------------- | ------------------------------------------------------- |
| `src/host/`    | Extension host: database, tokenizer, hover, commands    |
| `src/webview/` | The React sidebar app                                   |
| `src/shared/`  | Types and logic used by both                            |
| `scripts/`     | Data builds — dictionary, strokes, tokenizer dictionary |
| `e2e/`         | Playwright tests against a real VS Code                 |
| `docs/specs/`  | Design decisions and their history                      |
| `.bumpy/`      | Pending changelog entries                               |

## Reporting a bug

Open an issue at [github.com/Saeris/vscode-jisho/issues][issues]. Include the extension version, your OS, what you expected, what happened, and the smallest reproduction you can manage. If it involves a specific word, say which one — the dictionary data varies by entry.

[viteplus]: https://viteplus.dev/
[bumpy]: https://bumpy.varlock.dev/
[jmdict-simplified]: https://github.com/scriptin/jmdict-simplified
[node-sqlite]: https://nodejs.org/api/sqlite.html
[lindera]: https://github.com/lindera/lindera
[animcjk]: https://github.com/parsimonhi/animCJK
[issues]: https://github.com/Saeris/vscode-jisho/issues
