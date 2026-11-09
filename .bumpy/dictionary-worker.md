---
vscode-jisho: patch
---

**Searching no longer freezes VS Code.** Every extension shares one thread, and Jisho's dictionary queries used to run on it. A slow one — adding a `#noun` tag to the search box took up to 2 seconds — froze hovers, completions and every other extension for as long as it ran. The dictionaries now run on their own thread, so a slow search only delays its own results.
