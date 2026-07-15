# Polish Pass Plan

After M1–M7 shipped, a focused pass on **test infrastructure**, **efficiency**, and **visual refinement** before the first publish. Read [CONVENTIONS.md](CONVENTIONS.md) first.

## Motivation

Surfaced during M7 handwriting testing:

- Drawing `え` crashed the extension (degenerate-stroke NaN — fixed in `9c5a0d8`). We had no way to catch a webview-DOM bug like this before an F5 session.
- `patterns.ts` is a 6.7MB JS array literal — inefficient to parse, compile, and hold in heap.
- The recognizer (and the webview generally) need a more robust, layered test suite.
- We want a way to **drive the running extension** — both to catch regressions AND to let the agent visually iterate on the UI (screenshot → see → fix → re-screenshot).

## The testing pyramid (build bottom-up)

1. **Recognizer unit tests (broaden).** Pure functions, no browser. Per-stage tests (each distance metric, moment normalization, feature extraction) + wider real-character recognition coverage + the degenerate-input guards (done). Cheapest, highest density.
2. **Webview component tests (jsdom + @testing-library/react).** Test component logic without a real browser: `Handwriting.tsx` (pointer→stroke→chips, undo/clear — would have caught the `え` closure bug), and other views. Vitest already present; add the jsdom environment + Testing Library. **jsdom boundary found:** React Aria's `ListBox` focus/roving-tabindex machinery needs layout APIs jsdom lacks and throws when an option is programmatically focused — so the **keyboard-nav hand-off (#12: ↓ into results, ↑/Esc back)** is deferred to the E2E layer (real browser), not jsdom. jsdom covers rendering, query wiring, empty/degenerate states, and handler logic that moves focus _out_ of the ListBox.
3. **Host integration tests (`@vscode/test-electron` + `@vscode/test-cli`).** The official runner: launch real VS Code with the extension loaded, test in the extension host — activation, DB provisioning, message round-trips, the `WebviewViewProvider` registration. Cannot reach inside the webview DOM (host-side only).
4. **Full webview E2E (Playwright driving Electron).** The only layer that reaches the webview DOM — drawing canvas, rendered strokes, candidate chips, navigation. **Also the visual-iteration loop**: launch → drive → screenshot → the agent refines UI against real pixels. Highest setup; foundational for the visual-polish goal, so not "overkill" here.

   **Status: harness built and proven** (`e2e/`, `playwright.config.ts`) — a full run passed 3/3 in ~15s, including a DB-backed search and a real workbench screenshot. Hard-won findings:
   - **`ELECTRON_RUN_AS_NODE=1` must be deleted from the spawned env.** VS Code sets it in its integrated terminal and children inherit it; with it set, `Code.exe` boots as a _Node interpreter_, rejects app flags (`bad option: --remote-debugging-port`) and exits. This was the cause of every early "process failed to launch" — not the Electron-30 Playwright bug ([#39008](https://github.com/microsoft/playwright/issues/39008)), which only affects `_electron.launch` (we don't use it; we spawn + `connectOverCDP`).
   - **SAFETY: never `browser.close()` over a CDP attach** — it shuts the target down. An early version did this and **closed the developer's real VS Code windows**. Cleanup is PID-only, and we refuse to start if the debug port is already owned.
   - **Seed the temp `--user-data-dir`** + pass `@vscode/test-electron`'s canonical flags (`--skip-welcome`, `--skip-release-notes`, `--disable-updates`, `--no-cached-data`, `--disable-workspace-trust`) or a first-run sign-in modal overlays the workbench and contaminates screenshots.
   - **`Error: mutex already exists` is NON-FATAL noise** — it appears even on runs that then succeed. Don't chase it; it is not the cause of a failed launch.
   - **OPEN ISSUE — renderer hangs on an empty shell.** After several runs, launches began loading `workbench.html` but never rendering `.monaco-workbench` (blank dark window; DevTools auto-opens when `--extensionDevelopmentPath` is passed). Reproduces *without* seeded settings and *without* the dev path, i.e. the plain baseline now hangs even though the identical setup passed 3/3 earlier — so it looks like **machine/install state**, not the harness code. Attempting to delete `.vscode-test/` for a clean re-download fails with `Device or resource busy` while no process can be found holding it. **Next step:** fully clear the lock (reboot or find the handle owner), delete `.vscode-test/`, and re-run to confirm the harness is green from a clean install. If it is, add **tree-kill** cleanup (see `killTree` in `@vscode/test-electron/out/util.js`) — plain `proc.kill()` does not reap VS Code's process tree on Windows, which is the most likely way this state got poisoned.
   - **Cleanup must tree-kill.** `proc.kill()` only signals the launcher; VS Code's children survive and can hold the install/profile. `@vscode/test-electron` uses a `killTree` helper for exactly this.
   - `.vscode-test/` (224MB VS Code download), `test-results/`, `playwright-report/` are gitignored — they otherwise get swept into format/lint and break the gate.

5. **Visual regression tests.** Screenshot baselines. **Added AFTER the visual-polish work** — don't lock baselines of a UI we're about to change.

## Efficiency: binary patterns format

Replace the 6.7MB `patterns.ts` JS array literal with a **compact binary encoding**. The data is just integer coordinate arrays (`[char, strokeCount, Stroke[]]` where `Stroke = [x,y][]`). A flat typed-array blob (e.g. `Int16Array` + an index/offset table + a char table) would be ~2-3MB raw, decode near-instantly via `DataView`/typed arrays (no JS parse/compile, no JSON parse), and use a fraction of the heap. Encoder (build-time script) + decoder (webview) + re-run the fidelity suite to prove byte-identical patterns. Keep it lazy-loaded.

## Visual polish (the actual UI refinement)

Once E2E can screenshot the running extension, iterate on: layout/spacing consistency across views, the new M6/M7 surfaces (pitch contour alignment, examples disclosure, names section, stroke player controls, handwriting canvas), theme fidelity (light/dark/high-contrast), empty/loading/error states. Then lock visual-regression baselines.

## Sequencing

1 (recognizer units) → binary patterns (pairs with 1) → 2 (component tests) → 3 (host integration) → 4 (E2E + visual iteration) → visual polish → 5 (visual regression). Per-item commits + bump files. Standing gates per CONVENTIONS.
