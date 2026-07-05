---
vscode-jisho: minor
---

Initial dictionary implementation: an offline Japanese vocabulary search and word-detail view in the VSCode sidebar.

- Search by Japanese (kanji/kana) or English, ranked exact → prefix → substring with common words first.
- Word detail: all readings and kanji writings, senses grouped by part of speech, common badges, and cross-references.
- Data pipeline compiles [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) into a local SQLite database served by [@tursodatabase/database](https://www.npmjs.com/package/@tursodatabase/database).
- React webview (React Aria + TanStack Query + XState) themed to the active VSCode color theme.
