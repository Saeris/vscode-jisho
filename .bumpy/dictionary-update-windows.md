---
vscode-jisho: patch
---

Fixes updating the dictionary on Windows, which failed with "EPERM: operation not permitted" after downloading. The extension now releases the database before swapping the new one into place.
