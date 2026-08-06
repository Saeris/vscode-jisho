---
vscode-jisho: minor
---

Japanese text now wraps where a reader would break it. A sentence too long for the sidebar used to split between any two characters, stranding a particle at the start of a line; it now breaks at phrase boundaries, so 図書館に行って／精白米を食べました rather than 図書館に行って精白米／を食べました. Definitions and other English prose gained a little more space between lines, and no longer end on a single stranded word.

Smaller things that come with it: lines can no longer begin with small kana (っ ゃ ゅ ょ) or a long-vowel mark, parenthesised notes lose the stray indent before their opening bracket, and long romaji readings wrap instead of forcing the panel sideways.

This raises the minimum VS Code version to 1.123. The typography above is built on CSS that older versions cannot render, and the extension was already being tested against a much newer build than it claimed to support.
