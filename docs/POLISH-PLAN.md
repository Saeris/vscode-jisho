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
2. **Webview component tests (jsdom + @testing-library/react).** Test component logic without a real browser: `Handwriting.tsx` (pointer→stroke→chips, undo/clear — would have caught the `え` closure bug), and other views. Vitest already present; add the jsdom environment + Testing Library.
3. **Host integration tests (`@vscode/test-electron` + `@vscode/test-cli`).** The official runner: launch real VS Code with the extension loaded, test in the extension host — activation, DB provisioning, message round-trips, the `WebviewViewProvider` registration. Cannot reach inside the webview DOM (host-side only).
4. **Full webview E2E (Playwright driving Electron).** The only layer that reaches the webview DOM — drawing canvas, rendered strokes, candidate chips, navigation. **Also the visual-iteration loop**: launch → drive → screenshot → the agent refines UI against real pixels. Highest setup; foundational for the visual-polish goal, so not "overkill" here.
5. **Visual regression tests.** Screenshot baselines. **Added AFTER the visual-polish work** — don't lock baselines of a UI we're about to change.

## Efficiency: binary patterns format

Replace the 6.7MB `patterns.ts` JS array literal with a **compact binary encoding**. The data is just integer coordinate arrays (`[char, strokeCount, Stroke[]]` where `Stroke = [x,y][]`). A flat typed-array blob (e.g. `Int16Array` + an index/offset table + a char table) would be ~2-3MB raw, decode near-instantly via `DataView`/typed arrays (no JS parse/compile, no JSON parse), and use a fraction of the heap. Encoder (build-time script) + decoder (webview) + re-run the fidelity suite to prove byte-identical patterns. Keep it lazy-loaded.

## Visual polish (the actual UI refinement)

Once E2E can screenshot the running extension, iterate on: layout/spacing consistency across views, the new M6/M7 surfaces (pitch contour alignment, examples disclosure, names section, stroke player controls, handwriting canvas), theme fidelity (light/dark/high-contrast), empty/loading/error states. Then lock visual-regression baselines.

## Sequencing

1 (recognizer units) → binary patterns (pairs with 1) → 2 (component tests) → 3 (host integration) → 4 (E2E + visual iteration) → visual polish → 5 (visual regression). Per-item commits + bump files. Standing gates per CONVENTIONS.
