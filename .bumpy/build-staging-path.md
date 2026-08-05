---
---

The dictionary build now writes to `<db>.building` and renames it into place once it succeeds, instead of writing the destination directly. A rebuild no longer fails outright when a test runner or Extension Development Host has the old database open, a failed build leaves the last good database intact rather than deleting it, and nothing ever reads a half-built file.

If the final swap is the part that's blocked, the finished database is kept at `<db>.building` and the message says so — closing the holder and renaming recovers it, rather than the ten-minute build being discarded over a file lock. Cleanup after a failed build no longer masks the error that caused it.
