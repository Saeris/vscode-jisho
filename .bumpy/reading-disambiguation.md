---
vscode-jisho: patch
---

Hovering a word written with a kanji that several different words share now shows the right one. A single kanji like 本 can be written for both 本 (ほん, "book") and 元 (もと) — previously the hover could pick the more common writing regardless of how the word was actually read, so 本 sometimes showed 元, 風 showed 振り, and 息 showed 息子. The hover now uses the reading to resolve the word, so the entry it shows matches the word in the sentence. A new hand-judged accuracy corpus guards this and the earlier conjugation fixes against regressions.
