---
vscode-jisho: patch
---

The dictionary download is now zstd-compressed instead of gzip, shrinking each artifact by ~29% (the full dictionary drops from ~135MB to ~96MB) so first-run provisioning transfers less and decompresses faster.
