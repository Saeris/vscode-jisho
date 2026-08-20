---
vscode-jisho: patch
---

Fixes the dictionary going quiet when another VS Code window has it open. On Windows the refresh would fail with "EBUSY: resource busy or locked", and every word lookup silently stopped working while grammar notes kept going. Jisho now keeps using the copy it already has and says so in its log.
