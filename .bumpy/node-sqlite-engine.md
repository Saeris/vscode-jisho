---
vscode-jisho: minor
---

The dictionary now runs on Node's built-in SQLite instead of a bundled native database engine.

Browsing a large category was the thing that forced this: ordering "Nouns" by kana never finished, because the old engine's planner scanned all 218,290 words instead of using the tag index it had. The same queries now return in about 240ms, and the rest of the app got faster with them.

Two other things follow from it. **Intel Macs and Windows on ARM are supported again** — the old engine shipped no binary for either, which is the only reason they were dropped — and every download is ~13MB smaller, since the database no longer needs a native package at all.

Also fixed: a failed dictionary open (a version-mismatched or corrupt file) left its file handle open, which on Windows could block replacing the very file the extension was about to re-download.
