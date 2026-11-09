---
vscode-jisho: patch
---

**Part-of-speech colouring now works in a split view.** With the same document open twice side by side, only one side was ever coloured. Each editor now gets its own colouring.

**Colouring no longer freezes the editor.** A colouring pass used to hold VS Code for 80-200 ms at a time; it now gives way every few milliseconds, and a keystroke or a scroll interrupts it. Scrolling back over text that is already coloured costs nothing.
