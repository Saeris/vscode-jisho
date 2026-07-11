<div align="center">

# 📔 Jisho — Japanese Dictionary for VSCode

[![CI status][ci_badge]][ci]

An **offline** Japanese dictionary that lives in your VSCode sidebar. Look up unfamiliar vocabulary without leaving your editor or reaching for the internet — inspired by [Shirabe Jisho][shirabe].

</div>

---

## ✨ Features

- **Vocabulary search** — search by Japanese (kanji or kana), Hepburn romaji, _or_ English, with common words ranked first. Exact matches beat prefix matches beat substring matches.
- **Rich word detail** — every reading and kanji writing, senses grouped by part of speech, common-word badges, and cross-references.
- **Offline** — all lookups run against a local database bundled from open dictionary data. No network, no account, no context switch.
- **Theme-aware** — the UI is built on VSCode's own theme variables, so it matches whatever color theme you use (light, dark, or high-contrast) automatically.

Planned for later milestones: kanji detail with radical breakdown and stroke-order animation, pitch-accent notation, example sentences, JLPT word lists, names dictionary, and handwriting-based kanji search — see the [roadmap](./docs/ROADMAP.md) for the full sequence.

## 🛠 Development (running the extension)

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

> **Note:** F5 uses the workspace's `assets/jisho.db` directly (and picks up rebuilds automatically). Installed `.vsix` copies instead download the full dictionary on first activation — see [Dictionary delivery](#-dictionary-delivery).

## 📦 Building & packaging

```bash
vp check            # format + lint + typecheck
vp test             # run the test suite
vp run build        # build both targets and package a .vsix
```

The native SQLite engine ([`@tursodatabase/database`][turso]) ships a platform-specific `.node` addon that cannot be bundled, so it is packaged into the `.vsix` from `node_modules` (this is why packaging uses `vsce package --no-yarn` rather than `--no-dependencies`).

Marketplace releases are **per-platform packages**: `vp run build:platforms` builds one `.vsix` per target (Windows x64, macOS Apple Silicon, Linux x64/arm64) from a single machine by fetching each platform's prebuilt turso binary from npm — no cross-compilation or CI matrix needed. Bumpy's release flow runs this same script and publishes each package.

> **Platform note:** Intel Macs (darwin-x64) are unsupported until turso ships that binary; `vp run build` still produces a current-platform-only `.vsix` for local testing.

## 📚 Dictionary delivery

The full dictionary (~320MB, ~218k entries) is too large to bundle, so installed extensions **download it on first activation** into global storage: streamed, gunzipped, sha256-verified, with a progress notification — then everything is offline. In F5 development the workspace copy of `assets/jisho.db` is used directly instead (and refreshes automatically when you rebuild it).

The download comes from the rolling **`dictionary-latest`** GitHub Release, which is decoupled from extension releases so dictionary refreshes don't require publishing a new extension version. To create or refresh it (maintainer task):

```bash
vp run build:data:full   # builds assets/jisho.db + jisho-full.db.gz (+ .sha256, .version)
gh release create dictionary-latest --title "Dictionary data" --notes "Rolling JMdict database" \
  assets/jisho-full.db.gz assets/jisho-full.db.gz.sha256 assets/jisho-full.db.version
# or, to refresh an existing release:
gh release upload dictionary-latest --clobber \
  assets/jisho-full.db.gz assets/jisho-full.db.gz.sha256 assets/jisho-full.db.version
```

## 📣 Data sources & attribution

This extension is built on the work of several open dictionary projects. Their licenses require attribution, which is reproduced here (and will be surfaced in-app):

- **[JMdict / EDICT][jmdict]** — Japanese-English dictionary data, © the [Electronic Dictionary Research and Development Group (EDRDG)][edrdg], used under the [EDRDG License][edrdg-license]. Sourced via [jmdict-simplified][jmdict-simplified].
- **[KANJIDIC2][kanjidic]** — kanji character data (readings, meanings, stroke counts, grades, JLPT levels), © EDRDG, used under [CC BY-SA 4.0][cc-by-sa].
- **[KRADFILE / RADKFILE][kradfile]** — kanji radical/component decompositions, © EDRDG (RADKFILE2/KRADFILE2 © Jim Rose), used under the [EDRDG License][edrdg-license].
- **[JLPT vocabulary levels][tanos-jlpt]** — word-level JLPT tags, © [Jonathan Waller][tanos-jlpt] (tanos.co.uk), used under [CC BY-SA 4.0][cc-by-sa] via [yomitan-jlpt-vocab][yomitan-jlpt]. No official JLPT vocabulary list exists, so these levels are an unofficial community estimate.
- **[Pitch accent][kanjium]** — mora-position pitch accent notation, © Uros O. ([Kanjium][kanjium], derived from NHK/Wadoku data), used under [CC BY-SA 4.0][cc-by-sa].
- **[Example sentences][tatoeba]** — the Tanaka corpus, maintained by the [Tatoeba][tatoeba] project, used under [CC BY 2.0 FR][cc-by-fr] (embedded in JMdict via jmdict-simplified).

Additional sources (AnimCJK stroke data) will be added and credited as their features are implemented.

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
[kanjidic]: https://www.edrdg.org/wiki/index.php/KANJIDIC_Project
[kradfile]: https://www.edrdg.org/krad/kradinf.html
[tanos-jlpt]: https://www.tanos.co.uk/jlpt/
[yomitan-jlpt]: https://github.com/stephenmk/yomitan-jlpt-vocab
[kanjium]: https://github.com/mifunetoshiro/kanjium
[tatoeba]: https://tatoeba.org/
[cc-by-fr]: https://creativecommons.org/licenses/by/2.0/fr/deed.en
[cc-by-sa]: https://creativecommons.org/licenses/by-sa/4.0/
[turso]: https://www.npmjs.com/package/@tursodatabase/database
[viteplus]: https://viteplus.dev/
[bumpy]: https://bumpy.varlock.dev/
[license]: ./LICENSE.md
[personal-website]: https://saeris.gg
