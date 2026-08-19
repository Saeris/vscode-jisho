---
vscode-jisho: minor
---

Adds part-of-speech coloring inside the comments of your JavaScript and TypeScript files, behind the new `vscode-jisho.highlighting.codeComments` setting. Comments only — strings and identifiers are left alone, so the coloring never changes how the code itself reads. Comment boundaries come from the editor's own grammar, so `// inside a template literal` is correctly not a comment.
