---
vscode-jisho: patch
---

With part-of-speech highlighting turned on, typing Japanese prose now recolours once you pause rather than trying to keep up with every keystroke. Colouring a screenful of dense text is a tokenizer pass per visible line, and doing it mid-word was work spent on text you were still in the middle of writing. Scrolling and switching editors still repaint immediately — there the delay would be visible as uncoloured text you are already looking at.
