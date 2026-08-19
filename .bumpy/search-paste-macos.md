---
vscode-jisho: patch
---

Fixes pasting into the search box doing nothing on macOS. VS Code blocks a webview's own paste and then re-runs it through an API Electron has removed, so the search box now reads the clipboard and inserts the text itself.
