---
vscode-jisho: patch
---

Fixes 0.2.0 failing to start with "Cannot find module 'vscode-textmate'". The comment-highlighting libraries were loaded from disk instead of being built into the extension, so nothing worked at all. If you installed 0.2.0, this restores it.
