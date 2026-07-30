---
vscode-jisho: patch
---

"Remove furigana" now leaves markdown formatting untouched. It previously stripped emphasis markers (`*`, `**`, `_`, `` ` ``, `==`, `~~`) along with the ruby, so running it on `これは**重要**です` returned `これは重要です`.
