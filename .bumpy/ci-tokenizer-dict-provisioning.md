---
vscode-jisho: patch
---

Packaging now refuses to build an extension whose tokenizer dictionary is missing, instead of quietly producing one that cannot segment Japanese at all — no hovers, no word spacing, no furigana, no search breakdown.
