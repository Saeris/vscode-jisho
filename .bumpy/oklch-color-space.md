---
vscode-jisho: patch
---

Accent colors are now computed in the OKLCH color space: the conjugation-suffix highlight takes its lightness directly from your theme's text color (so it is exactly as readable as body text, in any theme) and all color blending — stroke highlights, chart emphasis — interpolates perceptually instead of through sRGB, which was muddying tones.
