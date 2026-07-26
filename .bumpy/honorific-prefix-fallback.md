---
vscode-jisho: patch
---

Hovering a polite word like お電話 or ご案内 now finds its definition. The tokenizer glues the honorific お/ご onto the word, and the combined form isn't a dictionary entry, so the hover previously came up empty. It now retries without the prefix when the plain word is a real entry — お電話 → 電話, ご案内 → 案内 — while leaving words where the prefix is part of the word itself (お茶, ご飯, お名前) untouched.
