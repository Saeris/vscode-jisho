---
vscode-jisho: patch
---

Hovering Japanese words in the editor now resolves them more accurately. Previously a word could match an unrelated same-sounding entry — hovering the し of してください showed 死 ("death") or 擦る ("to rub") instead of する ("to do"). The hover now uses the part of speech the tokenizer already knows, so it lands on the right entry.
