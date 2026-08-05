---
---

Development provisioning now hard-links the built dictionary into global storage instead of copying it.

Copying the ~450MB `assets/jisho.db` was costing **7.3 seconds** of every fresh-profile activation — by far the largest thing standing between launching and the first search, while actually opening the database took 2ms. Linking measures 41ms, so a cold first search went from ~7.5s to under half a second, and the duplicate 450MB on disk is gone.

Falls back to a real copy when linking cannot work (global storage on a different volume from the repo, or a filesystem without hard links), so the outcome is identical either way. Installed users are unaffected — they download rather than link.

The `.version` sidecar check that already prevented a stale cached database now does double duty: a rebuild renames a new file into place, so without it the old link would keep resolving to the previous dictionary.
