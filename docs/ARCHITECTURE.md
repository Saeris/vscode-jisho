# Architecture

How Jisho fits together: the runtimes it runs in, how they talk, the state machines that own its moving parts, how the dictionary data is built and delivered, and where each of the project's invariants is enforced. Start here, then follow the links: the code they point to is the authority, and this map says which file to open.

For the rules of working in the codebase, see [CONVENTIONS.md](CONVENTIONS.md). For setup, see [CONTRIBUTING.md](../CONTRIBUTING.md). The audit this map grew out of is [AUDIT-2026-11.md](AUDIT-2026-11.md).

## Three places code runs

| Where                           | Runtime                                                         | What runs there                                                                                                                                             | What it may not use                                                                                      |
| ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Extension host**, main thread | VS Code 1.145's Node 24.22, shared by every installed extension | Activation, the hover, part-of-speech colouring, editor commands, the tokenizer (Lindera, native), the webview bridge's host side                           | Anything slow and synchronous: one stall freezes every extension's hovers and completions                |
| **Dictionary worker**           | A Node `worker_thread` in the extension host                    | Both dictionaries (`node:sqlite`, synchronous) — [dictionaryWorker.ts](../src/host/dictionaryWorker.ts), reached through [remote.ts](../src/host/remote.ts) | `vscode` (it exists only on the main thread); arguments and results must be plain, structured-clone data |
| **Webview**                     | Chromium 148 (Electron)                                         | The sidebar UI (React, React Aria, TanStack Query, XState), speech, handwriting recognition                                                                 | Node APIs; it reaches the host only through the bridge                                                   |

The two Node-and-Chromium runtimes are not interchangeable: `Uint8Array.fromBase64` exists only in Chromium (and Node 25+), and Vitest runs a webview `.ts` spec under Node unless it is listed in `BROWSER_ONLY` in [vite.config.ts](../vite.config.ts). `vp pack` builds the host and the worker (`dist/extension.cjs`, `dist/dictionaryWorker.cjs`, and the chunk they share, `dist/db.cjs`); `vp build` builds the webview.

## The bridge

The webview asks the host for everything it shows, over `postMessage`.

- **One protocol definition.** [messages.ts](../src/shared/messages.ts) describes each request and its answer once, in `Protocol`. `Request`, `Response` and the `Handlers` table type are derived from it.
- **Host side.** The webview host ([webviewHost.ts](../src/host/webviewHost.ts)) answers through one `Handlers` table (`#buildHandlers`); the dictionary handlers live in [dispatch.ts](../src/host/dispatch.ts). `answer()` labels each answer with its request's `type` and `requestId`, so a handler cannot mislabel one, and a handler that answers in another request's shape does not compile.
- **Webview side.** [bridge.ts](../src/webview/bridge.ts) sends with random request ids, times out a request that gets no answer (60 s), and buffers pushes that arrive before anything subscribes. [queries.ts](../src/webview/queries.ts) wraps the requests as TanStack Query options.
- **Pushes.** The host also pushes, unasked: `hostSettings`, `dictionaryStatus` (both dictionaries' lifecycle state) and `hostPush` (editor commands such as "Look Up Selection").
- **A hidden panel.** The view keeps its context when hidden (`retainContextWhenHidden`), but a hidden webview receives nothing. The host holds answers and pushes in an outbox and delivers them when the view is visible again.

## State machines

Each moving part has one owner, with its states written down.

- **A dictionary's lifecycle** — [lifecycle.ts](../src/host/lifecycle.ts), `DictionaryLifecycle`. `absent → downloading(%) → opening → ready`; `failed(reason)` on any failure, with a retry from the next request; `ready(updating%) → swapping → ready` for an update; `ready → absent` when the worker dies (`lost`). The diagram is at the top of the file. The panel shows the state ([DictionaryNotice.tsx](../src/webview/components/DictionaryNotice.tsx)) and offers the recovery each failure reason needs ([failure.ts](../src/host/failure.ts) classifies them: `offline`, `schema-older`, `schema-newer`, `io`).
- **Navigation** — [machines/navigation.ts](../src/webview/machines/navigation.ts), an XState machine: the view stack, forward history, tabs, and what survives a reload (`hydrateContext`).
- **Speech** — [speech.ts](../src/webview/speech.ts) owns the page's one `speechSynthesis` queue: any new speech stops every other sequence.
- **The colouring pass** — [posDecorations.ts](../src/host/posDecorations.ts): per editor, a generation per pass, yielding to the event loop every 8 ms, with each line's colouring cached by its text.
- **Lazy values** — [lazy.ts](../src/shared/lazy.ts): the tokenizer, the recognizer chunk, the comment grammars and the speech voice are each made on first use, with their failure policy (`retry` or `keep`) stated where they are made.

## Data: from source to an installed dictionary

1. **Build.** [build-data.ts](../scripts/build-data.ts) turns JMdict, JMnedict, Kanjidic, Tatoeba and the rest into SQLite databases shaped by [schema.sql](../src/data/schema.sql): the full word dictionary, the common one (tests and contributors), and the optional names dictionary. Each comes with a `.zst` archive, its `.sha256`, and a `.version` sidecar that names the schema (`full schema7 …`).
2. **Publish.** The "Dictionary Data" workflow ([dictionary.yml](../.github/workflows/dictionary.yml)) builds every schema that a published release still reads, each from the newest code that reads it ([data-builds.ts](../scripts/data-builds.ts)), and publishes each to its own release tag, `dictionary-v{schema}`. `dictionary-latest` is frozen at schema 6 for versions 0.1–0.3 ([schema.ts](../src/shared/schema.ts)).
3. **Download.** On first use the extension downloads its own schema's archive ([download.ts](../src/host/download.ts), `DATA_RELEASE_BASE`), driven by the lifecycle ([ensureDatabase.ts](../src/host/ensureDatabase.ts)).
4. **Update.** A daily, offline-safe check compares the remote `.version` with the installed one and offers an update; it never offers a schema this build cannot read ([dictionaryUpdate.ts](../src/host/dictionaryUpdate.ts)).

### What happens if the download fails halfway?

[download.ts](../src/host/download.ts) streams the archive into `<db>.part`, hashing the compressed bytes as they pass, and renames the file into place only after its sha256 matches the published one. On any error — a dropped connection, a checksum mismatch — it deletes the `.part` and rethrows. So a failed download never replaces anything: on first run there is still no dictionary, and during an update the old one is still in place and still serving. A `.part` left by a crash is removed at the next start (`sweepDictionaryStorage`).

The lifecycle records the failure as `failed(reason)`: `offline` for a network failure, `io` for anything else, such as a checksum mismatch or a full disk ([failure.ts](../src/host/failure.ts)). The status reaches the panel ([DictionaryNotice.tsx](../src/webview/components/DictionaryNotice.tsx)). For `offline` it says it couldn't download the dictionary and offers **Try again**; for `io` it says it couldn't open the dictionary and offers **Try again** or a report. A new attempt starts the download from the beginning. During an update, the dictionary stays `ready` throughout, because the download runs beside the open file and only a verified file is swapped in.

## Releases

1. Every PR adds a changeset under `.bumpy/` (an empty one when nothing user-facing changed).
2. Bumpy keeps a version PR open with the pending changes. On that PR, CI runs the release gates: the full test suite against the real data, the end-to-end suite in VS Code, and the Publish job's own steps with nothing published — the data check, per-platform packaging, and `publish-vsix.ts --dry-run` ([ci.yml](../.github/workflows/ci.yml)).
3. Merging the version PR runs [release.yml](../.github/workflows/release.yml): the gates again, then `check-data-release.ts` (this schema's dictionary must be published), then one `.vsix` per platform ([package-platforms.ts](../scripts/package-platforms.ts)), published to the Marketplace and then Open VSX ([publish-vsix.ts](../scripts/publish-vsix.ts)).

## Where each invariant is enforced

The invariants the audit found unenforced, and what holds each one now.

|      | Invariant                                             | Enforced by                                                                                                                                                                                        |
| ---- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-0  | Names download only when the user asks                | The names lifecycle provisions only on `installNames`; other requests use `acquireIfInstalled` ([webviewHost.ts](../src/host/webviewHost.ts)); `webviewHost.spec.ts`                               |
| I-1  | Every installed version can read its data release     | A release tag per schema; `dictionary-latest` frozen at schema 6 ([schema.ts](../src/shared/schema.ts)); every live schema rebuilt ([data-builds.ts](../scripts/data-builds.ts)); `schema.spec.ts` |
| I-2  | A schema mismatch leads to the right recovery         | `classifyFailure` ([failure.ts](../src/host/failure.ts)) and `DictionaryNotice`; the update refuses another schema ([dictionaryUpdate.ts](../src/host/dictionaryUpdate.ts))                        |
| I-3  | An answer has its request's type                      | The `Handlers` type and `answer()` ([dispatch.ts](../src/host/dispatch.ts)); `protocol.spec.ts`                                                                                                    |
| I-4  | The statement cache stays bounded                     | An LRU of 256 ([store.ts](../src/host/store.ts)); `store.spec.ts`                                                                                                                                  |
| I-5  | A query does not stall the shared thread              | The dictionaries run in a worker ([dictionaryWorker.ts](../src/host/dictionaryWorker.ts)); `remote.spec.ts`                                                                                        |
| I-6  | Every `View` can be restored                          | `VIEW_FIELDS … satisfies Record<View["name"], …>` ([navigation.ts](../src/webview/machines/navigation.ts))                                                                                         |
| I-7  | Generated files can be regenerated                    | **Not yet**: the recognizer's pattern encoder is not in the tree (BACKLOG #21); [patterns.data.ts](../src/webview/recognizer/patterns.data.ts) now says so                                         |
| I-8  | SQL and JavaScript rank results the same way          | `RANK_ORDER_BY` and `byRank` side by side ([search.ts](../src/host/queries/search.ts)); `searchRanking.spec.ts`                                                                                    |
| I-9  | The published data matches the version being released | `check-data-release.ts`, in the release and on the version PR                                                                                                                                      |
| I-10 | The packager checks the files the provisioner writes  | One file list for both ([lindera-dict.ts](../scripts/lindera-dict.ts)); `packaging.spec.ts`                                                                                                        |
| I-11 | Every release step runs before release day            | The version PR's packaging gate; `publish-vsix.ts --dry-run`; the data workflow's `publish: false` dry run                                                                                         |
| I-12 | An editor transform applies, or says why not          | `transformEditorText` ([editorCommands.ts](../src/host/editorCommands.ts)); `editorCommands.spec.ts`                                                                                               |
| I-13 | Reports never include the user's paths                | `sanitizeText` in `issueUrl` ([diagnostics.ts](../src/shared/diagnostics.ts)); its privacy tests                                                                                                   |
| I-14 | The sidebar keeps its state when hidden               | `retainContextWhenHidden` and the host's outbox ([webviewHost.ts](../src/host/webviewHost.ts))                                                                                                     |
| I-15 | Lazy values state their failure policy                | `lazy()` ([lazy.ts](../src/shared/lazy.ts))                                                                                                                                                        |
