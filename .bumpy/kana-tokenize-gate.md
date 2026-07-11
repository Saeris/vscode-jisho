---
vscode-jisho: patch
---

The part-of-speech breakdown bar no longer appears for all-kana queries (にほんごをはなしますか), which the tokenizer can't segment reliably without kanji boundaries — those now search directly. Mixed-script queries with kanji (日本語を話しますか) still show the breakdown.