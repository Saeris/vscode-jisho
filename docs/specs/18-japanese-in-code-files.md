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

1. **Ask the tokenizer nothing; ask the grammar.** VS Code does not expose TextMate scopes to extensions ([microsoft/vscode#580](https://github.com/microsoft/vscode/issues/580) is the long-standing request). The workaround the ecosystem uses is [vscode-textmate](https://github.com/microsoft/vscode-textmate) directly — running the grammar in-process — which means shipping and maintaining grammar resolution.

2. **Detect comment syntax per language.** A small table of line/block comment delimiters (`//`, `#`, `--`, `/* */`, `<!-- -->`, `"""`), applied to the line under the cursor. Crude, and wrong inside a string containing `//` — but the failure mode is a hover that offers a definition for Japanese text that is genuinely there, which is benign. This is what the existing `stripRuby` machinery already does in spirit: work on the line, not the AST.

### Revised 2026-08-19: (1), on measurement

This section originally recommended **(2)**, calling (1) "heavy" — an estimate, not a measurement. Building a proof against VS Code's own shipped TypeScript grammar reversed it on every axis that mattered.

**Correctness.** The cases (2) gets wrong are not exotic; they are ordinary TypeScript:

| Line                                | (1) TextMate      | (2) delimiter table         |
| ----------------------------------- | ----------------- | --------------------------- |
| `// これはコメントです`             | comment           | comment                     |
| `const msg = "こんにちは"; // 挨拶` | only `// 挨拶`    | only `// 挨拶`              |
| `` `テンプレート ${x} // ここ` ``   | **not** a comment | **wrongly** a comment       |
| `/* 複数行の` … `コメント */`       | both lines        | needs its own state machine |
| `/** JSDoc: 図書館へ行きます */`    | comment           | comment                     |

The template-literal row is the decisive one. Getting it right by hand needs `${}` nesting tracking — a parallel implementation of something the grammar already does, and precisely the bespoke maintenance this feature does not want to own.

**Cost, measured rather than assumed.** `vscode-textmate` 9.3.2 is 95 KB; `vscode-oniguruma` 2.0.1 is 507 KB (mostly the WASM). Tokenizing real TypeScript source: **0.069 ms per line — 8.3 ms for a 120-line screenful**, against a repaint path already debounced 150 ms. Startup is 36 ms for the WASM plus 6 ms for a grammar, both lazy and paid only when a matching file is opened.

**Grammar resolution is not ours to maintain.** Grammars are discovered at runtime from the editor the user is already running: `vscode.extensions.all` → `packageJSON.contributes.grammars` → `extensionUri`. Verified present in a stock install — `source.ts`, `source.js`, and the `.tsx`/`.jsx` variants. Nothing is bundled, and a language the user has installed comes with its own grammar, so Python, Go and Rust follow from the same plumbing rather than from a growing delimiter table.

**It survives M8 (web extension).** The concern that this ties us to the desktop host does not hold, and this was checked rather than assumed:

- `vscode.workspace.fs` + `extensionUri` **work in web** — already established in [spec 06](06-web-extension.md) for the stroke SVGs. Reading a grammar is the same operation on the same API.
- Neither library imports a single Node builtin (`fs`, `path`, `crypto`, …): both are pure computation over strings.
- `oniguruma.loadWASM` accepts a `Response`, a browser-first input. These libraries are what VS Code itself runs in the browser to highlight vscode.dev.

The one genuine risk is that grammar discovery reads another extension's `packageJSON` — a documented-but-informal path. A missing or unparseable grammar must degrade to "no highlighting in that language", never throw.

**Recommendation: (1), gated by a setting**, with (2) NOT kept as a fallback — a second code path that is wrong on template literals would produce inconsistent behaviour that is harder to explain than a language simply not being covered.

### What running it across five more languages found

TextMate does abstract most of this: one `comment` scope prefix matches `//`, `#`, `/* */` and `<!-- -->` alike, with no delimiter table on our side, and string literals are excluded everywhere for free. But "most" was worth checking, and checking found three things a JS-only test could not have.

**Python docstrings are not comments.** A `"""…"""` is scoped `string.quoted.docstring.multi.python`, not `comment`, so the prefix alone left Python's most common form of prose uncovered. The scope still separates it cleanly from an ordinary `string.quoted.single`, so `isProseScope` matches `docstring` explicitly and the comments-only boundary holds. Worth noting what this buys: a docstring and a plain string are the same thing to a lexer — what distinguishes them is POSITION, which the grammar has already worked out.

**A language grammar can be a shim.** VS Code's `html` extension contributes `text.html.derivative` for the language and `text.html.basic` with no `language` field at all; the derivative is nearly empty and delegates through `include: text.html.basic#…`. Indexing only language grammars left that include unresolvable, so HTML tokenized to nothing and no comment was ever found. Discovery now keeps two maps — languages to scopes, and **every** scope to its file.

**The grammar does not descend into Markdown inside a doc comment.** Every line of a fenced block in JSDoc — the fences, the code, the prose either side — is uniformly `comment.block.documentation.ts`. Markdown emphasis is already handled by `stripRuby`, so **bold**, `code`, lists, links and tables all tokenize correctly; a fenced block holds CODE, though, and is excluded by tracking the fence state ourselves, seeded from the top of the file the same way the rule stack is.

Verified end to end for JS/TS, HTML, CSS, Python, PHP and Rust: comment coloured, string literal untouched.

## Scope and open questions for the implementer

- Which languages? A curated list is predictable but needs maintenance; `"*"` with comment detection is broader but appears everywhere. **Ask the user.**
- Do the POS decorations follow the same rule? They share `DECORATED_LANGUAGES`, and colouring only comments in a code file may look arbitrary next to coloured syntax. Possibly hover-only to start.
- Ruby markup (`{食|た}べる`) in a code comment is unlikely but the machinery is shared, so it costs nothing to keep working.

## Until then

The documentation describes what the extension does: hover and highlighting work in **Markdown and plain text**. The README's screenshots use those fixtures rather than promising a code-file scenario the extension does not support. `e2e/docs/fixtures/checkout.ts` is retained — it is the scenario to capture once this ships.
