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
import { lazy, type Lazy } from "../shared/lazy";

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

/**
 * Whether an extension ships WITH VS Code rather than being installed by the user.
 *
 * Built-ins win a contested scope name. That is not a preference for Microsoft's grammars — it is
 * that a scope name is not owned by whoever registers it first, and `extensions.all` enumerates
 * user extensions BEFORE built-ins. Measured on a real install: `csstools.postcss` contributes
 * `scopeName: "source.css"` for its own `postcss` language, so first-wins resolved the `css`
 * LANGUAGE to postcss's grammar file. It happened to tokenize comments the same way, so nothing
 * broke — but a language resolving to a different extension's grammar is wrong on its own terms,
 * and the next collision might not be so lucky.
 */
const isBuiltin = (extension: vscode.Extension<unknown>): boolean =>
  extension.id.startsWith("vscode.") ||
  extension.extensionUri.path.includes("/resources/app/extensions/");

const discoverGrammars = (): GrammarIndex => {
  const byLanguage = new Map<string, string>();
  const byScope = new Map<string, vscode.Uri>();
  // Built-ins first, so a user extension cannot claim a scope or a language they already define.
  // Within each pass the first contribution still wins, which settles collisions between two user
  // extensions the same way VS Code's own ordering would.
  const ordered = [
    ...vscode.extensions.all.filter(isBuiltin),
    ...vscode.extensions.all.filter((e) => !isBuiltin(e))
  ];
  for (const extension of ordered) {
    for (const entry of contributedGrammars(extension.packageJSON)) {
      const grammar = asGrammarEntry(entry);
      if (!grammar) continue;
      const uri = vscode.Uri.joinPath(extension.extensionUri, grammar.path);
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
  /**
   * Each language's grammar, made once. KEPT, `null` included: a language no extension contributes a
   * grammar for, or whose grammar cannot load, will not gain one this session — and retrying would
   * redo the same failing work on every repaint. The feature degrades to "no comments" instead.
   */
  readonly #grammars = new Map<string, Lazy<IGrammar | null>>();
  /**
   * The oniguruma WASM every grammar needs, loaded once. A failure is KEPT for the same reason: a
   * WASM that will not instantiate now will not on the next keystroke either. Logged once, here.
   */
  readonly #wasm = lazy(
    async (): Promise<void> => {
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
      } catch (err) {
        log().warn(`oniguruma wasm failed to load: ${String(err)}`);
        throw err;
      }
    },
    { onFailure: "keep" }
  );
  /** The rule stack at every 100th line of each document — see `LineStates`. */
  readonly #states = new LineStates();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Whether one POSITION sits inside a comment.
   *
   * The hover's question, where the decorator asks for whole lines. Both go through the same
   * tokenizing path, so a `//` inside a template literal is not a comment for either — the two
   * features cannot disagree about what a comment is, which they would if the hover had its own
   * notion.
   *
   * False whenever the answer is not knowable: no grammar for this language, an unreadable grammar,
   * a failed WASM load. The hover then does nothing, which is what it did before this existed.
   */
  async isComment(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<boolean> {
    const [spans] = await this.commentSpans(
      document,
      position.line,
      position.line
    );
    return (spans ?? []).some(
      (span) =>
        position.character >= span.start && position.character < span.end
    );
  }

  /**
   * The comment spans on each of `lines`, in order.
   *
   * The whole block is tokenized in one call because a TextMate grammar is STATEFUL: whether a line
   * sits inside a block comment is carried in the rule stack from the line before it. Handing this
   * one line at a time would report the interior of every `/* … *​/` as ordinary code.
   *
   * `from` is the document line the block starts at. The state there is recovered from the nearest
   * checkpoint above it — see `LineStates` — since a rule stack cannot be computed mid-document
   * without tokenizing everything before it.
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
      // The fenced state is recovered with the rule stack, for the same reason: a viewport that
      // begins INSIDE a fenced block has no way to know that from its first line alone.
      let { stack, fenced } = this.#states.at(document, grammar, from);
      const spans: CommentSpan[][] = [];
      for (let line = from; line <= to; line++) {
        // Passing a checkpoint line: keep the state, so the next hover or pass starts from here.
        this.#states.record(document, grammar, line, { stack, fenced });
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
    let grammar = this.#grammars.get(languageId);
    if (!grammar) {
      grammar = lazy(async () => this.#resolveGrammar(languageId), {
        onFailure: "keep"
      });
      this.#grammars.set(languageId, grammar);
    }
    return grammar.get();
  }

  /** Find, load and compile the grammar for a language — or `null`, logged, when it cannot. */
  async #resolveGrammar(languageId: string): Promise<IGrammar | null> {
    this.#sources ??= discoverGrammars();
    const scopeName = this.#sources.byLanguage.get(languageId);
    // Every `return null` below is logged. This feature's failure mode is SILENCE — it degrades
    // to "no comments", which is indistinguishable from the setting being off, so a user seeing
    // nothing has no way to tell which. A CSS report we could not reproduce is what made that
    // cost concrete: there was no line in the log to ask for.
    if (scopeName === undefined) {
      log().warn(
        `no grammar contributed for language "${languageId}" — comment features are off for it ` +
          `(${this.#sources.byLanguage.size} languages known)`
      );
      return null;
    }
    if (!(await this.#loadWasm())) return null;
    try {
      this.#registry ??= new Registry({
        onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
        loadGrammar: async (scope): Promise<IRawGrammar | null> =>
          this.#rawGrammar(scope)
      });
      const grammar = await this.#registry.loadGrammar(scopeName);
      if (!grammar) {
        // `loadGrammar` resolves to null rather than throwing when an INCLUDE cannot be
        // satisfied, so this is the quietest failure of the four and the one most likely to
        // depend on which extensions a user has installed.
        log().warn(
          `grammar "${scopeName}" for "${languageId}" resolved to nothing — an include it needs ` +
            `is probably missing`
        );
        return null;
      }
      log().info(`grammar ready for "${languageId}" (${scopeName})`);
      return grammar;
    } catch (err) {
      log().warn(`grammar load failed for ${languageId}: ${String(err)}`);
      return null;
    }
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
  /** Whether the WASM is loaded; false (and logged once) when it cannot be. */
  async #loadWasm(): Promise<boolean> {
    try {
      await this.#wasm.get();
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.#registry?.dispose();
    this.#registry = undefined;
    this.#grammars.clear();
  }
}

/**
 * A fenced code block's delimiter, inside a doc comment.
 *
 * ```` * ```ts ```` and ```` * ``` ```` both match, as does the bare form in a `#`-comment language.
 * The leading comment furniture (`*`, `//`, `#`) is skipped before looking, since a fence inside a
 * JSDoc block is indented behind it.
 */
const FENCE = /^\s*(?:[*]|\/\/|#|--)?\s*(?:```|~~~)/u;

const isFence = (line: string): boolean => FENCE.test(line);

/** The tokenizing state BEFORE a line: the grammar's rule stack, and whether a fence is open. */
export interface LineState {
  stack: StateStack;
  /**
   * Whether the line sits inside a fenced code block. The grammar cannot say: every line of a
   * ```` ``` ```` block inside a JSDoc comment — the fences, the code, the prose around it — is
   * uniformly `comment.block.documentation.ts`, because TextMate does not descend into Markdown
   * nested in a doc comment. So it is ours to track, from the top, like the rule stack.
   */
  fenced: boolean;
}

/** Lines between checkpoints. A lookup tokenizes at most this many lines past the nearest one. */
const CHECKPOINT_EVERY = 100;

/** Documents whose checkpoints are kept. Least recently used dropped first. */
const DOCUMENTS_KEPT = 16;

/**
 * The tokenizing state at every 100th line of a document, for one version of it.
 *
 * The state at a line is defined by every line above it, so recovering it meant tokenizing from
 * line 0 — on every hover, which has no debounce: ~140 ms at line 2,000 (audit P-4). With
 * checkpoints, a lookup tokenizes from the nearest one at or above it: at most 99 lines. An edit
 * changes the document's version, which drops its checkpoints.
 */
export class LineStates {
  readonly #documents = new Map<
    string,
    { version: number; grammar: IGrammar; at: Map<number, LineState> }
  >();

  /** The state before `line`, tokenizing from the nearest checkpoint and keeping the ones it passes. */
  at(
    document: vscode.TextDocument,
    grammar: IGrammar,
    line: number
  ): LineState {
    const checkpoints = this.#checkpoints(document, grammar);
    let from = line - (line % CHECKPOINT_EVERY);
    while (from > 0 && !checkpoints.has(from)) from -= CHECKPOINT_EVERY;
    let { stack, fenced } = checkpoints.get(from) ?? {
      stack: INITIAL,
      fenced: false
    };
    for (let above = from; above < line; above++) {
      if (above % CHECKPOINT_EVERY === 0)
        checkpoints.set(above, { stack, fenced });
      const text = document.lineAt(above).text;
      stack = grammar.tokenizeLine(text, stack).ruleStack;
      if (isFence(text)) fenced = !fenced;
    }
    this.record(document, grammar, line, { stack, fenced });
    return { stack, fenced };
  }

  /** Keep `state` as the state before `line`, if that line is a checkpoint. */
  record(
    document: vscode.TextDocument,
    grammar: IGrammar,
    line: number,
    state: LineState
  ): void {
    if (line % CHECKPOINT_EVERY === 0)
      this.#checkpoints(document, grammar).set(line, state);
  }

  /** This version's checkpoints, started afresh when the document or its grammar has changed. */
  #checkpoints(
    document: vscode.TextDocument,
    grammar: IGrammar
  ): Map<number, LineState> {
    const key = document.uri.toString();
    let entry = this.#documents.get(key);
    if (entry?.version !== document.version || entry.grammar !== grammar) {
      entry = { version: document.version, grammar, at: new Map() };
    }
    // Re-inserted on every use, so the Map's order stays least-recently-used first.
    this.#documents.delete(key);
    this.#documents.set(key, entry);
    if (this.#documents.size > DOCUMENTS_KEPT) {
      const oldest = this.#documents.keys().next();
      if (oldest.done !== true) this.#documents.delete(oldest.value);
    }
    return entry.at;
  }
}

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
