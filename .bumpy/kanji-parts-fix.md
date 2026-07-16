---
vscode-jisho: patch
---

Fixed the kanji parts list, where tapping certain components (ノ ハ マ ユ ヨ ｜) led to a "Kanji not found" dead end. These are stroke shapes rather than characters — real building blocks (ノ appears in 1,415 kanji) that simply have no dictionary entry of their own. Tapping one now opens the radical lookup showing every kanji built from that part, which is what you were asking for anyway. The section is also now called "Parts" rather than "Components", matching what the data actually describes.
