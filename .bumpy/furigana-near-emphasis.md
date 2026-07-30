---
vscode-jisho: patch
---

"Add furigana" and "Add spacing" now handle text with markdown formatting correctly. Kanji wrapped in `*emphasis*` or `**bold**` previously got no furigana at all, and spacing landed inside the markers (`私 は** 本** を 読む`).
