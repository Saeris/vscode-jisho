---
vscode-jisho: minor
---

Adds part-of-speech coloring inside the comments of your code, behind the new `vscode-jisho.highlighting.codeComments` setting. JavaScript, TypeScript, HTML, CSS, Python, PHP and Rust are covered, including Python's docstrings and the Markdown people write inside doc comments.

Comments only — strings and identifiers are left alone, so the coloring never changes how the code itself reads. Comment boundaries come from the editor's own grammar, so `// inside a template literal` is correctly not a comment, and a fenced code block inside a doc comment is skipped like any other code.
