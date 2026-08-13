---
vscode-jisho: patch
---

Fixes the prefilled bug report opening with `%23%23%23` where its `###` headings belong, which left reporters writing around a broken template. VS Code re-encoded the report while opening it; the URL is now handed over in a form it leaves alone.
