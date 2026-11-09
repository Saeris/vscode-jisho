---
vscode-jisho: patch
---

Internal toolchain upgrade: Yarn 4.18.1, Vite+ 1.5.0 and Vitest v5. No change to how the extension behaves — the benchmark suite moved to the new API, and `vp run bench:compare` now fails a run that regresses rather than printing a number beside it.
