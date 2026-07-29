---
vscode-jisho: patch
---

Slang the standard dictionary doesn't know — きもい, うざい, エモい — now works. Previously the tokenizer broke these into meaningless fragments (き・も・い), so hovering or highlighting them found nothing. A small curated dictionary of colloquial words now teaches them to the tokenizer as proper adjectives, and it can grow as more are added.
