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
 * The `scopeName` of a language's grammar, e.g. `source.ts`, and where its file lives.
 *
 * Built by scanning what the editor has installed rather than from a table of our own, so this
 * follows the user's extensions instead of needing to be kept in step with them.
 */
interface GrammarSource {
  scopeName: string;
  uri: vscode.Uri;
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

/** One `contributes.grammars` entry, when it has the three fields we need. */
const asGrammarEntry = (
  entry: unknown
): { language: string; scopeName: string; path: string } | undefined => {
  if (typeof entry !== "object" || entry === null) return undefined;
  const { language, scopeName, path } = entry as {
    language?: unknown;
    scopeName?: unknown;
    path?: unknown;
  };
  return typeof language === "string" &&
    typeof scopeName === "string" &&
    typeof path === "string"
    ? { language, scopeName, path }
    : undefined;
};

const discoverGrammars = (): Map<string, GrammarSource> => {
  const found = new Map<string, GrammarSource>();
  for (const extension of vscode.extensions.all) {
    const contributed = contributedGrammars(extension.packageJSON);
    for (const entry of contributed) {
      // An injection grammar (JSDoc, regex) has a `scopeName` and no `language`. Those are loaded
      // by the engine on demand, not selected by us, so only language grammars are indexed here.
      const grammar = asGrammarEntry(entry);
      if (!grammar) continue;
      // First contribution wins: a user's language extension is not allowed to silently displace
      // the built-in grammar for a language we have already resolved.
      if (found.has(grammar.language)) continue;
      found.set(grammar.language, {
        scopeName: grammar.scopeName,
        uri: vscode.Uri.joinPath(extension.extensionUri, grammar.path)
      });
    }
  }
  return found;
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
  #sources: Map<string, GrammarSource> | undefined;
  /** Resolved grammars, and the languages that have been tried and failed (cached as `null`). */
  readonly #grammars = new Map<string, Promise<IGrammar | null>>();
  #wasm: Promise<boolean> | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Whether a language has a grammar at all, without loading it. Cheap enough to call per pass. */
  supports(languageId: string): boolean {
    this.#sources ??= discoverGrammars();
    return this.#sources.has(languageId);
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
      const spans: CommentSpan[][] = [];
      for (let line = from; line <= to; line++) {
        const result = grammar.tokenizeLine(document.lineAt(line).text, stack);
        stack = result.ruleStack;
        spans.push(mergeSpans(result.tokens));
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
      const source = this.#sources.get(languageId);
      if (!source) return null;
      if (!(await this.#loadWasm())) return null;
      try {
        this.#registry ??= new Registry({
          onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
          loadGrammar: async (scope): Promise<IRawGrammar | null> =>
            this.#rawGrammar(scope)
        });
        return await this.#registry.loadGrammar(source.scopeName);
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
    for (const source of this.#sources.values()) {
      if (source.scopeName !== scopeName) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(source.uri);
        return parseRawGrammar(
          new TextDecoder().decode(bytes),
          source.uri.path
        );
      } catch (err) {
        log().warn(`grammar read failed for ${scopeName}: ${String(err)}`);
        return null;
      }
    }
    return null;
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
    // `comment` covers `comment.line.double-slash.ts`, `comment.block.documentation.ts` and the
    // rest; matching the prefix is how TextMate scope selectors work.
    if (!token.scopes.some((scope) => scope.startsWith("comment"))) continue;
    const last = spans.at(-1);
    if (last && last.end === token.startIndex) last.end = token.endIndex;
    else spans.push({ start: token.startIndex, end: token.endIndex });
  }
  return spans;
};
