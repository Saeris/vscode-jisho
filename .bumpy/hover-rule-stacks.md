---
vscode-jisho: patch
---

Hovering Japanese in a code comment no longer slows down further into a long file. Each hover used to re-read the file from the top, about 140 ms at line 2,000; it now starts from a saved point at most 100 lines above.
