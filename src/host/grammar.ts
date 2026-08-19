/**
 * Where the comments are, according to the editor's own grammar.
 *
 * Colouring Japanese in a code file needs an answer to "is this position inside a comment", and
 * VS Code does not expose one — [microsoft/vscode#580](https://github.com/microsoft/vscode/issues/580)
 * has asked for TextMate scopes since 2015. So we run the grammar ourselves, with the same library
 * the editor uses.
 *
 * Spec 18 originally proposed a table of comment delimiters instead, and measuring reversed that.
 * The cases a delimiter table gets wrong are ordinary TypeScript, not exotic:
 *
 *   const t = `テンプレート ${x} // ここはコメントではない`;
 *
 * Getting that right by hand means tracking `${}` nesting — reimplementing what the grammar already
 * does. Block comments spanning lines need their own state machine on top. The cost of NOT doing
 * that by hand is 0.069ms per line (measured on real TypeScript source), against a repaint path
 * already debounced 150ms.
 *
 * Nothing is bundled. Grammars are read from the editor the user is running, so a language they
 * have installed brings its own — which is why this generalises past JS/TS without a growing table.
 *
 * Web-safe by construction: `vscode.workspace.fs` and `extensionUri` are VS Code APIs rather than
 * Node ones (the same reason the stroke SVGs need no change for M8, spec 06), neither library
 * imports a Node builtin, and `loadWASM` takes an `ArrayBuffer`.
 */
import * as vscode from "vscode";
import {
  INITIAL,
  parseRawGrammar,
  Registry,
  type IGrammar,
  type IRawGrammar,
  type StateStack
} from "vscode-textmate";
import {
  createOnigScanner,
  createOnigString,
  loadWASM
} from "vscode-oniguruma";
import { log } from "./log";

/**
 * A half-open `[start, end)` column span of one line that is inside a comment.
 *
 * Columns, not offsets into a substring: the caller maps them straight onto a `vscode.Range`.
 */
export interface CommentSpan {
  start: number;
  end: number;
}

/**
 * Every grammar the running editor contributes, indexed by `languageId`.
 *
 * Reading another extension's `packageJSON` is a documented-but-informal path, so every field is
 * treated as untrusted: a malformed contribution is skipped rather than allowed to throw during
 * activation of an unrelated feature.
 */
/**
 * The `contributes.grammars` array of a manifest, or empty when it has none.
 *
 * `packageJSON` is typed `any`, so every step down is checked rather than asserted — this is
 * another extension's data, and a shape we assumed rather than validated would throw inside our
 * activation because someone else shipped an unusual manifest.
 */
const contributedGrammars = (manifest: unknown): unknown[] => {
  if (typeof manifest !== "object" || manifest === null) return [];
  const { contributes } = manifest as { contributes?: unknown };
  if (typeof contributes !== "object" || contributes === null) return [];
  const { grammars } = contributes as { grammars?: unknown };
  return Array.isArray(grammars) ? grammars : [];
};

/**
 * One `contributes.grammars` entry, when it names a scope and a file.
 *
 * `language` is OPTIONAL here, and that is the point. A grammar with no language is not selectable
 * by us — but it is very often the one that does the actual work: VS Code's `html` extension
 * contributes `text.html.derivative` for the language and `text.html.basic` with no language at
 * all, and the derivative is a near-empty shim whose rules are all `include: text.html.basic#…`.
 * Indexing only language grammars left that include unresolvable, so an HTML file tokenized to
 * nothing and no comment was ever found.
 */
const asGrammarEntry = (
  entry: unknown
): { language?: string; scopeName: string; path: string } | undefined => {
  if (typeof entry !== "object" || entry === null) return undefined;
  const { language, scopeName, path } = entry as {
    language?: unknown;
    scopeName?: unknown;
    path?: unknown;
  };
  if (typeof scopeName !== "string" || typeof path !== "string")
    return undefined;
  return typeof language === "string"
    ? { language, scopeName, path }
    : { scopeName, path };
};

/**
 * Every grammar the running editor contributes, in two indexes.
 *
 * `byLanguage` answers "which scope do I tokenize a .py file with"; `byScope` answers "where is the
 * file for scope X", and must hold EVERY grammar rather than only the selectable ones — a language
 * grammar routinely `include`s scopes that are contributed without a `language` of their own, and
 * the engine asks us for those by name while it loads.
 */
interface GrammarIndex {
  byLanguage: Map<string, string>;
  byScope: Map<string, vscode.Uri>;
}

const discoverGrammars = (): GrammarIndex => {
  const byLanguage = new Map<string, string>();
  const byScope = new Map<string, vscode.Uri>();
  for (const extension of vscode.extensions.all) {
    for (const entry of contributedGrammars(extension.packageJSON)) {
      const grammar = asGrammarEntry(entry);
      if (!grammar) continue;
      const uri = vscode.Uri.joinPath(extension.extensionUri, grammar.path);
      // First contribution wins in both maps: a later extension is not allowed to silently
      // displace a grammar already resolved for the same language or scope.
      if (!byScope.has(grammar.scopeName)) byScope.set(grammar.scopeName, uri);
      if (grammar.language !== undefined && !byLanguage.has(grammar.language))
        byLanguage.set(grammar.language, grammar.scopeName);
    }
  }
  return { byLanguage, byScope };
};

/**
 * The tokenizer, built once and shared.
 *
 * Everything here is lazy and failure-tolerant. This feature is an enhancement to reading a code
 * file, and every path that cannot produce an answer returns "no comments" — the file simply goes
 * uncoloured, which is the behaviour before this existed.
 */
export class CommentScopes implements vscode.Disposable {
  #registry: Registry | undefined;
  #sources: GrammarIndex | undefined;
  /** Resolved grammars, and the languages that have been tried and failed (cached as `null`). */
  readonly #grammars = new Map<string, Promise<IGrammar | null>>();
  #wasm: Promise<boolean> | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Whether a language has a grammar at all, without loading it. Cheap enough to call per pass. */
  supports(languageId: string): boolean {
    this.#sources ??= discoverGrammars();
    return this.#sources.byLanguage.has(languageId);
  }

  /**
   * The comment spans on each of `lines`, in order.
   *
   * The whole block is tokenized in one call because a TextMate grammar is STATEFUL: whether a line
   * sits inside a block comment is carried in the rule stack from the line before it. Handing this
   * one line at a time would report the interior of every `/* … *​/` as ordinary code.
   *
   * `from` is the document line the block starts at. Tokenizing begins at the top of the file when
   * the block does not, because there is no way to recover the rule stack mid-document — see
   * `#stackAt`.
   */
  async commentSpans(
    document: vscode.TextDocument,
    from: number,
    to: number
  ): Promise<CommentSpan[][]> {
    const empty = (): CommentSpan[][] =>
      Array.from({ length: Math.max(0, to - from + 1) }, () => []);
    const grammar = await this.#grammar(document.languageId);
    if (!grammar) return empty();

    try {
      let stack = stackAt(document, grammar, from);
      // Seeded from the top of the file for the same reason as the rule stack: a viewport that
      // begins INSIDE a fenced block has no way to know that from its first line alone.
      let fenced = fencedAt(document, from);
      const spans: CommentSpan[][] = [];
      for (let line = from; line <= to; line++) {
        const text = document.lineAt(line).text;
        const result = grammar.tokenizeLine(text, stack);
        stack = result.ruleStack;
        const fence = isFence(text);
        // A fence line is itself excluded, and so is everything between a pair of them.
        const inside = fenced || fence;
        if (fence) fenced = !fenced;
        // Pushed unconditionally, INCLUDING the empty result for a line with no comment: the
        // caller maps `spans[i]` back to line `from + i`, so skipping a line here would shift every
        // later span onto the wrong one.
        spans.push(inside ? [] : mergeSpans(result.tokens));
      }
      return spans;
    } catch (err) {
      log().warn(`grammar tokenize failed: ${String(err)}`);
      return empty();
    }
  }

  /** The grammar for a language, or null when there is none or it could not be read. */
  async #grammar(languageId: string): Promise<IGrammar | null> {
    const cached = this.#grammars.get(languageId);
    if (cached) return cached;

    const resolving = (async (): Promise<IGrammar | null> => {
      this.#sources ??= discoverGrammars();
      const scopeName = this.#sources.byLanguage.get(languageId);
      if (scopeName === undefined) return null;
      if (!(await this.#loadWasm())) return null;
      try {
        this.#registry ??= new Registry({
          onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
          loadGrammar: async (scope): Promise<IRawGrammar | null> =>
            this.#rawGrammar(scope)
        });
        return await this.#registry.loadGrammar(scopeName);
      } catch (err) {
        log().warn(`grammar load failed for ${languageId}: ${String(err)}`);
        return null;
      }
    })();
    this.#grammars.set(languageId, resolving);
    return resolving;
  }

  /** Read and parse one grammar file, by scope name. Used for the language AND its includes. */
  async #rawGrammar(scopeName: string): Promise<IRawGrammar | null> {
    this.#sources ??= discoverGrammars();
    const uri = this.#sources.byScope.get(scopeName);
    if (!uri) return null;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return parseRawGrammar(new TextDecoder().decode(bytes), uri.path);
    } catch (err) {
      log().warn(`grammar read failed for ${scopeName}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Load the oniguruma WASM, once.
   *
   * Read through `vscode.workspace.fs` rather than `node:fs` so the same code serves the web
   * extension host (M8), where there is no `fs` at all.
   */
  async #loadWasm(): Promise<boolean> {
    this.#wasm ??= (async (): Promise<boolean> => {
      try {
        const uri = vscode.Uri.joinPath(
          this.extensionUri,
          "assets",
          "onig.wasm"
        );
        const bytes = await vscode.workspace.fs.readFile(uri);
        // A copy, not a subarray view: `readFile` may return a view into a larger pooled buffer,
        // and the loader instantiates the WHOLE ArrayBuffer it is handed.
        await loadWASM(bytes.slice().buffer);
        return true;
      } catch (err) {
        log().warn(`oniguruma wasm failed to load: ${String(err)}`);
        return false;
      }
    })();
    return this.#wasm;
  }

  dispose(): void {
    this.#registry?.dispose();
    this.#registry = undefined;
    this.#grammars.clear();
  }
}

/**
 * The rule stack as it stands at `line`, by tokenizing everything above it.
 *
 * There is no cheaper way: the stack at a line is defined by every line before it. The cost is
 * bounded by where the user is looking rather than by file size in general, and at 0.069ms per line
 * even a 2000-line file is ~140ms on a debounced path — paid once per pass, off the keystroke.
 */
const stackAt = (
  document: vscode.TextDocument,
  grammar: IGrammar,
  line: number
): StateStack => {
  let stack: StateStack = INITIAL;
  for (let above = 0; above < line; above++)
    stack = grammar.tokenizeLine(document.lineAt(above).text, stack).ruleStack;
  return stack;
};

/**
 * A fenced code block's delimiter, inside a doc comment.
 *
 * ```` * ```ts ```` and ```` * ``` ```` both match, as does the bare form in a `#`-comment language.
 * The leading comment furniture (`*`, `//`, `#`) is skipped before looking, since a fence inside a
 * JSDoc block is indented behind it.
 */
const FENCE = /^\s*(?:[*]|\/\/|#|--)?\s*(?:```|~~~)/u;

const isFence = (line: string): boolean => FENCE.test(line);

/**
 * Whether `line` sits inside a fenced code block, by counting fences above it.
 *
 * The grammar cannot answer this. Measured: every line of a ```` ``` ```` block inside a JSDoc
 * comment — the fences, the code, the prose around it — is uniformly
 * `comment.block.documentation.ts`, because TextMate does not descend into Markdown nested in a
 * doc comment. So the state is ours to track, and it has to be recovered the same way the rule
 * stack is: from the top.
 */
const fencedAt = (document: vscode.TextDocument, line: number): boolean => {
  let fenced = false;
  for (let above = 0; above < line; above++)
    if (isFence(document.lineAt(above).text)) fenced = !fenced;
  return fenced;
};

/**
 * Whether a TextMate scope names prose written for a human reader.
 *
 * `comment` is a prefix match, which is how scope selectors work: it covers
 * `comment.line.double-slash.ts`, `comment.block.documentation.ts`, `comment.line.number-sign.python`
 * and every other language's variants without a table of our own. Verified against the grammars VS
 * Code ships for HTML, CSS, Python, PHP and Rust — line comments, block comments and multi-line
 * blocks all resolve, and string literals in every one of them do not.
 *
 * A Python DOCSTRING is the one case the prefix misses. TextMate scopes it as
 * `string.quoted.docstring.multi.python` rather than as a comment, because it is syntactically a
 * string — but it is a docstring precisely BECAUSE of where it sits, and the grammar has already
 * made that judgement for us. Excluding it would leave Python's most common form of prose
 * uncovered, so `docstring` is matched too. An ordinary Python string is `string.quoted.single`,
 * which this does not match, so the comments-only boundary still holds.
 */
const isProseScope = (scope: string): boolean =>
  scope.startsWith("comment") || scope.includes("docstring");

/**
 * The comment tokens of one line, merged into as few spans as possible.
 *
 * A grammar emits `//` and its text as separate tokens, and a JSDoc line arrives in several more.
 * Merging adjacent ones keeps the caller's work proportional to comments rather than to tokens, and
 * avoids splitting a Japanese word across two spans — which would tokenize each half on its own and
 * colour them as different parts of speech.
 */
const mergeSpans = (
  tokens: ReadonlyArray<{
    startIndex: number;
    endIndex: number;
    scopes: string[];
  }>
): CommentSpan[] => {
  const spans: CommentSpan[] = [];
  for (const token of tokens) {
    if (!token.scopes.some(isProseScope)) continue;
    const last = spans.at(-1);
    if (last && last.end === token.startIndex) last.end = token.endIndex;
    else spans.push({ start: token.startIndex, end: token.endIndex });
  }
  return spans;
};
