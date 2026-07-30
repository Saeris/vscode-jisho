# Visual capture suites

One file per feature vertical. These are a screenshot harness for reviewing the UI against real pixels, not assertions — visual-regression baselines come after the polish work, since locking baselines of a UI we are about to redesign would be backwards.

All of them share ONE VS Code (the worker-scoped `vscode` fixture in `../fixtures.ts`), so the split costs no extra launches. Each test takes the `jisho` fixture, which hands back the webview reset to an empty search — without that, a file would silently depend on which files ran before it.

Shots land in `test-results/shots/`. Run one vertical with `vp exec playwright test e2e/visual/word-detail`.
