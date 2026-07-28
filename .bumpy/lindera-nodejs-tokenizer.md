---
vscode-jisho: patch
---

The Japanese tokenizer now runs on Lindera's native Node binding instead of the WebAssembly build. Tokenization is unchanged — the same word segmentation and readings — but this moves to the current Lindera release (the WASM package was stuck several versions behind) and opens the door to custom dictionary entries for slang and colloquial words that the standard dictionary misses. The compiled dictionary now ships alongside the extension rather than embedded in the tokenizer.
