---
vscode-jisho: patch
---

Fixed stroke-order drawings showing the wrong character on macOS. A few dozen kanji have a second, legacy codepoint that means the same character, and each shipped its own drawing — but macOS treats the two as the same filename, so one silently replaced the other and those kanji drew the wrong glyph. Only one drawing per character now ships, and the legacy codepoint resolves to it.
