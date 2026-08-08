# Spec 18 — Japanese in code files: hover and highlighting beyond Markdown

**Backlog:** new. **Status:** SPECIFIED, not implemented. Found while building the documentation screenshots (spec 17).

## The finding

The editor features are registered for **two languages only**:

```ts
// src/extension.ts:152
vscode.languages.registerHoverProvider(["markdown", "plaintext"], { … })

// src/host/posDecorations.ts:26
export const DECORATED_LANGUAGES = ["markdown", "plaintext"];
```

So hovering Japanese in a `.ts`, `.py` or `.go` file does nothing. This was discovered the expensive way: a documentation screenshot of "hover a Japanese comment in a TypeScript file" was written, failed, and was debugged through several rounds of automation theories — TypeScript's own hover winning the dwell, Monaco virtualising off-screen lines, character offsets landing in the wrong span — before the actual cause turned out to be that **the feature does not apply there at all**.

That scenario was assumed to work by both the user and the implementer. It reads as the extension's home turf — a developer reading a codebase with Japanese comments is exactly who this is for — which is why nobody questioned it.

## What is wanted

Japanese **in comments**, in ordinary source files. The user's framing: _"if all we could get is just support for comments in other languages, that would be fine; I don't necessarily need every string to be supported."_

That narrower target is also the better one, and not only for effort:

- **String literals are contested.** Measured during the screenshot work: hovering Japanese inside a TypeScript string literal produced TypeScript's own hover (`(property) outOfStock: "…"`) rather than the dictionary's. The language service owns that position and wins. A comment has no competing provider.
- **A comment is unambiguously prose.** A string literal may be an identifier, a key, a URL, or a format template — tokenizing it as Japanese is sometimes wrong. A Japanese comment is always Japanese being read by a human.

## The `/* md */` question, answered

The user asked whether a language hint would help:

```ts
const md = /* md */ `some **markdown** in a template literal`;
```

**It would not, on its own.** That pattern is provided by extensions such as [comment-tagged-templates](https://github.com/mjbvz/vscode-comment-tagged-templates), and it works by **injecting a TextMate grammar** into the tagged range. TextMate grammars drive _syntax highlighting_ — they colour text. They do not register hover providers, and they do not change which `languageId` a document reports.

The two mechanisms are separate ([Syntax Highlight Guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide)):

| Mechanism        | What it does                            | Relevant here?                     |
| ---------------- | --------------------------------------- | ---------------------------------- |
| TextMate grammar | Lexical colouring, single file          | No — colour only, no hover         |
| Semantic tokens  | Colouring informed by a language server | No — same, colour only             |
| Hover provider   | Content on dwell, per document selector | **Yes** — this is what we register |

So a `/* md */` hint makes an editor _paint_ the literal as Markdown while `document.languageId` stays `typescript`. Our selector still does not match. The hint is a red herring for hover — but it is a real signal we could CHOOSE to honour, and worth keeping in mind for the string-literal case if it is ever pursued.

## How to find comments

`document.languageId` is the wrong axis on its own — matching `["typescript", "python", …]` would enable hover across whole files, including strings and identifiers.

Two approaches, in preference order:

1. **Ask the tokenizer nothing; ask the grammar.** VS Code does not expose TextMate scopes to extensions ([microsoft/vscode#580](https://github.com/microsoft/vscode/issues/580) is the long-standing request). The workaround the ecosystem uses is [vscode-textmate](https://github.com/microsoft/vscode-textmate) directly — running the grammar in-process — which means shipping and maintaining grammar resolution. Heavy.

2. **Detect comment syntax per language.** A small table of line/block comment delimiters (`//`, `#`, `--`, `/* */`, `<!-- -->`, `"""`), applied to the line under the cursor. Crude, and wrong inside a string containing `//` — but the failure mode is a hover that offers a definition for Japanese text that is genuinely there, which is benign. This is what the existing `stripRuby` machinery already does in spirit: work on the line, not the AST.

**Recommendation: (2), gated by a setting.** The existing `hover.enabled` covers markdown/plaintext; a separate `hover.codeComments` (default off) avoids changing behaviour for anyone who did not ask for it, and avoids the extension appearing in every language's hover stack by default.

## Scope and open questions for the implementer

- Which languages? A curated list is predictable but needs maintenance; `"*"` with comment detection is broader but appears everywhere. **Ask the user.**
- Do the POS decorations follow the same rule? They share `DECORATED_LANGUAGES`, and colouring only comments in a code file may look arbitrary next to coloured syntax. Possibly hover-only to start.
- Ruby markup (`{食|た}べる`) in a code comment is unlikely but the machinery is shared, so it costs nothing to keep working.

## Until then

The documentation describes what the extension does: hover and highlighting work in **Markdown and plain text**. The README's screenshots use those fixtures rather than promising a code-file scenario the extension does not support. `e2e/docs/fixtures/checkout.ts` is retained — it is the scenario to capture once this ships.
