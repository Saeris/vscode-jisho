---
vscode-jisho: patch
---

Searching a word made of several kanji (図書館) no longer asks the database whether each character exists before looking it up — hydrating the rows already answers that. It saves a round trip per character, and the Kanji section shows exactly the same characters in the same order.
