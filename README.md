<div align="center">

# 📖 Jisho — Japanese Dictionary for VSCode

[![CI status][ci_badge]][ci]

An **offline** Japanese dictionary that lives in your VSCode sidebar. Look up unfamiliar vocabulary without leaving your editor or reaching for the internet — inspired by [Shirabe Jisho][shirabe].

</div>

---

## ✨ Features

- **Vocabulary search** — search by Japanese (kanji or kana) _or_ English, with common words ranked first. Exact matches beat prefix matches beat substring matches.
- **Rich word detail** — every reading and kanji writing, senses grouped by part of speech, common-word badges, and cross-references.
- **Offline** — all lookups run against a local database bundled from open dictionary data. No network, no account, no context switch.
- **Theme-aware** — the UI is built on VSCode's own theme variables, so it matches whatever color theme you use (light, dark, or high-contrast) automatically.

Planned for later milestones: kanji detail with radical breakdown and stroke-order animation, pitch-accent notation, example sentences, JLPT word lists, and handwriting-based kanji search.

## 🚀 Development (running the extension)

This extension has three build targets: the **extension host** bundle (`vp pack` → a CommonJS `.cjs` VSCode loads in its Node extension host), the **webview** app (`vp build` → the React UI that renders in the sidebar), and a one-off **data build** (`vp run build:data` → the SQLite dictionary). The first two are wired into the F5 debug flow; the data build you run occasionally.

### 1. Install dependencies and build the dictionary

```bash
vp install          # install dependencies
vp run build:data   # download JMdict → build assets/jisho.db (a one-off, ~8s)
```

`build:data` downloads the latest [`jmdict-eng-common`][jmdict-simplified] release and compiles it into `assets/jisho.db`. You only need to re-run it to refresh the dictionary data. The database is **not** committed (it's a build artifact) and is **not** bundled into the published `.vsix` — see [Dictionary delivery](#-dictionary-delivery) below.

### 2. Run it with F5

Press **`F5`** (Run → Start Debugging) in this project. VSCode will:

1. Run the `build` task (builds `dist/extension.cjs` and `dist/webview/`).
2. Open a second window titled **`[Extension Development Host]`** with the extension loaded from this folder.

In that window, click the **Jisho** icon in the activity bar and search (`たべる`, `eat`, `食べる`…). Because F5 runs from your workspace folder, the extension finds `assets/jisho.db` directly.

### 3. Iterate

- Run the **`watch`** task once (Terminal → Run Task → `watch`) to rebuild the host and webview on every change.
- In the Extension Development Host window, press **`Ctrl+R`** (Reload Window) to load the latest build. Stop debugging with **`Shift+F5`**.

> **Note:** F5 works because `context.extensionUri` points at this folder (where `assets/jisho.db` lives). The _installed_ `.vsix` does not yet contain the database — implementing first-run download is a pending task (see below).

## 📦 Building & packaging

```bash
vp check            # format + lint + typecheck
vp test             # run the test suite
vp run build        # build both targets and package a .vsix
```

The native SQLite engine ([`@tursodatabase/database`][turso]) ships a platform-specific `.node` addon that cannot be bundled, so it is packaged into the `.vsix` from `node_modules` (this is why packaging uses `vsce package --no-yarn` rather than `--no-dependencies`).

> **Platform note:** a locally-built `.vsix` only contains the native binary for _your_ platform. A marketplace release will need per-platform `.vsix` files (`vsce package --target …`).

## 🗄️ Dictionary delivery

The full dictionary is large, so the plan is to **download it on first activation** into the extension's global storage (keeping the `.vsix` small). That download backend is not implemented yet — for now, develop via F5, where the workspace copy of `assets/jisho.db` is used directly. The `ensureDatabase` seam is designed so the call site won't change when the downloader lands.

## 📚 Data sources & attribution

This extension is built on the work of several open dictionary projects. Their licenses require attribution, which is reproduced here (and will be surfaced in-app):

- **[JMdict / EDICT][jmdict]** — Japanese-English dictionary data, © the [Electronic Dictionary Research and Development Group (EDRDG)][edrdg], used under the [EDRDG License][edrdg-license]. Sourced via [jmdict-simplified][jmdict-simplified].

Additional sources (Kanjidic, Kradfile/Radkfile, Tatoeba example sentences, Kanjium pitch accent, JLPT lists, and AnimCJK stroke data) will be added and credited as their features are implemented.

## 🤝 Contributing

The project uses [Vite+][viteplus] as a unified toolchain (Oxlint + Oxfmt + tsdown + Vitest) and [Bumpy][bumpy] for versioning and release.

```bash
vp install           # install dependencies
vp check --fix       # format + lint + typecheck (with autofixes)
vp test              # run Vitest
yarn bumpy add       # create a bump file describing your change
```

## 🥂 License

Extension source released under the [MIT license][license] © [Drake Costa][personal-website]. Bundled dictionary data remains under its respective upstream licenses (see [Data sources & attribution](#-data-sources--attribution)).

[ci_badge]: https://github.com/Saeris/vscode-jisho/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/Saeris/vscode-jisho/actions/workflows/ci.yml
[shirabe]: https://ricoapps.com/
[jmdict]: http://www.edrdg.org/jmdict/j_jmdict.html
[jmdict-simplified]: https://github.com/scriptin/jmdict-simplified
[edrdg]: https://www.edrdg.org/
[edrdg-license]: https://www.edrdg.org/edrdg/licence.html
[turso]: https://www.npmjs.com/package/@tursodatabase/database
[viteplus]: https://viteplus.dev/
[bumpy]: https://bumpy.varlock.dev/
[license]: ./LICENSE.md
[personal-website]: https://saeris.gg
