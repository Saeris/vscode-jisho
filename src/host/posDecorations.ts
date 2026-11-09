/**
 * Part-of-speech colouring in the EDITOR, via text decorations.
 *
 * This replaces a semantic-token provider that borrowed *code* token types (verb → `function`,
 * particle → `keyword`) so themes would colour them for free. That was clever but capped the
 * feature at what themes happen to style: only six categories could be expressed, so pronoun,
 * adnominal and utterance had no colour at all, and a verb inherited whatever the theme paints
 * function calls — which carries the wrong meaning and varies wildly between themes.
 *
 * Decorations cost more plumbing (nothing asks us for them, so we own invalidation) but are the
 * only mechanism that can express our palette: nine categories, with per-theme light/dark values
 * chosen by VS Code itself through `DecorationRenderOptions`.
 */
import * as vscode from "vscode";
import type { CommentScopes, CommentSpan } from "./grammar";
import {
  SUPPORTED_LANGUAGES,
  codeCommentsEnabled,
  isProse
} from "./hostSettings";
import { japaneseRuns, stripRuby } from "./hover";
import { hasKanji } from "../shared/japanese";
import { segment } from "./tokenizer";
import { log } from "./log";
import {
  PALETTE_CATEGORIES,
  palette,
  type PaletteCategory,
  type PaletteId
} from "../shared/posPalette";

/**
 * How long typing must pause before the colouring repaints. Long enough to sit between keystrokes
 * at any realistic typing speed — including kana input, where one character is several keystrokes —
 * and short enough that the repaint reads as part of stopping rather than as a lag.
 */
const REFRESH_DELAY_MS = 150;

/**
 * How long a pass works before it lets the extension host run something else.
 *
 * `segment()` resumes through the microtask queue, and VS Code's events — a keystroke, a scroll —
 * are macrotasks, so a pass that never yields cannot be interrupted at all: a probe saw a
 * "keystroke" run only after a whole 100-line pass had finished (audit SM-6), with every other
 * extension blocked for those ~80-200 ms (P-2: ~120 lines at the 0.68 ms a line that
 * `bench/tokenize.bench.ts`, "highlight walk", measures). Yielding this often keeps a stall to
 * about one slice.
 */
const SLICE_MS = 8;

/** Lines whose colouring is remembered. At ~120 lines a viewport, many screens' worth. */
const LINE_CACHE_SIZE = 5000;

/** Let the extension host handle pending events, then carry on. */
const yieldToHost = async (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/** One coloured stretch of a line: its category and its columns in the document's line. */
interface Colouring {
  category: PaletteCategory;
  start: number;
  end: number;
}

/**
 * Each line's colouring, keyed by the line's text, least recently used dropped first.
 *
 * The colouring of a line depends only on its text, so scrolling back over text already coloured —
 * or a repaint after an edit elsewhere — needs no tokenizer call for it. Keyed by text, not line
 * number, so an edit that moves lines does not invalidate them.
 */
class LineCache {
  readonly #lines = new Map<string, readonly Colouring[]>();

  get(text: string): readonly Colouring[] | undefined {
    const hit = this.#lines.get(text);
    if (hit !== undefined) {
      // Re-inserted, so the Map's order stays least-recently-used first.
      this.#lines.delete(text);
      this.#lines.set(text, hit);
    }
    return hit;
  }

  set(text: string, colouring: readonly Colouring[]): void {
    this.#lines.set(text, colouring);
    if (this.#lines.size > LINE_CACHE_SIZE) {
      const oldest = this.#lines.keys().next();
      if (oldest.done !== true) this.#lines.delete(oldest.value);
    }
  }
}

const isDecorated = (document: vscode.TextDocument): boolean =>
  SUPPORTED_LANGUAGES.includes(document.languageId);

/**
 * One decoration type per category, holding BOTH ground variants.
 *
 * `light`/`dark` in `DecorationRenderOptions` is resolved by VS Code against the active theme and
 * re-resolved when the theme changes, so the palette follows light/dark with no listener of ours.
 * We only rebuild these when the user picks a different palette.
 */
type DecorationSet = Record<PaletteCategory, vscode.TextEditorDecorationType>;

const createDecorations = (id: PaletteId): DecorationSet => {
  const dark = palette(id, "dark");
  const light = palette(id, "light");
  const decorationFor = (
    category: PaletteCategory
  ): vscode.TextEditorDecorationType =>
    vscode.window.createTextEditorDecorationType({
      // Colour only — no background or border. This is running prose: anything heavier competes
      // with the text itself and makes a coloured paragraph unreadable.
      light: { color: light[category].css },
      dark: { color: dark[category].css },
      // Decorations must survive edits at their boundaries without smearing onto new text.
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
  // Spelled out rather than built in a loop: the compiler then checks that every category has an
  // entry, instead of us asserting a `Partial` is complete. Adding a category fails to compile
  // here, which is exactly where it should fail.
  return {
    utterance: decorationFor("utterance"),
    pronoun: decorationFor("pronoun"),
    noun: decorationFor("noun"),
    adnominal: decorationFor("adnominal"),
    adjective: decorationFor("adjective"),
    adverb: decorationFor("adverb"),
    verb: decorationFor("verb"),
    auxiliary: decorationFor("auxiliary"),
    particle: decorationFor("particle")
  };
};

/** Is a POS one the palette colours? `other` (punctuation) deliberately is not. */
const isColoured = (pos: string): pos is PaletteCategory =>
  (PALETTE_CATEGORIES as readonly string[]).includes(pos);

/** The colouring of one line of text, in document columns. */
const colourLine = async (text: string): Promise<Colouring[]> => {
  // `"drop"` because this is ANALYSIS, not a rewrite: emphasis markers are removed so
  // `彼に*遅れない*ように` reads as one Japanese run. The offset maps put the ranges back.
  const stripped = stripRuby(text, "drop");
  // Gate on the LINE, not the run. A run is whatever sits between punctuation, so
  // `もしもし、私は…` splits into a kana-only run and a kanji-bearing one — and gating per run
  // would skip もしもし, ゆっくり and every other kana word. That would silently erase the
  // utterance category, which is almost entirely kana (もしもし, ああ, えと).
  //
  // The constraint the gate exists for is real but coarser: a line with NO kanji anywhere is
  // usually not prose the tokenizer can segment reliably (no script transitions to anchor word
  // boundaries on), and wrong colouring teaches wrong boundaries.
  if (!hasKanji(stripped.text)) return [];
  const colouring: Colouring[] = [];
  for (const run of japaneseRuns(stripped.text)) {
    const segments = await segment(run.text);
    let offset = run.start;
    for (const seg of segments) {
      // Morphemes, not segments: auxiliaries are folded into their verb for searching
      // (食べ+まし+た → 食べました), but colouring them separately is the point — it shows the
      // internal structure of a conjugation.
      for (const part of seg.parts) {
        const end = offset + part.surface.length;
        if (isColoured(part.pos)) {
          colouring.push({
            category: part.pos,
            start: stripped.starts[offset],
            end: stripped.ends[end - 1]
          });
        }
        offset = end;
      }
    }
  }
  return colouring;
};

/**
 * Colour one editor's VISIBLE lines.
 *
 * Scoped to `visibleRanges` rather than the whole document because each line costs a tokenizer
 * call — the semantic-token provider this replaces walked every line of the file. A generous
 * margin is added so scrolling a little does not reveal uncoloured text before the next pass.
 */
const computeRanges = async (
  editor: vscode.TextEditor,
  superseded: () => boolean,
  cache: LineCache,
  scopes?: CommentScopes
): Promise<Map<PaletteCategory, vscode.Range[]> | undefined> => {
  const ranges = new Map<PaletteCategory, vscode.Range[]>();
  for (const category of PALETTE_CATEGORIES) ranges.set(category, []);

  const { document } = editor;
  const MARGIN = 40;
  const lines = new Set<number>();
  for (const visible of editor.visibleRanges) {
    const from = Math.max(0, visible.start.line - MARGIN);
    const to = Math.min(document.lineCount - 1, visible.end.line + MARGIN);
    for (let line = from; line <= to; line++) lines.add(line);
  }

  /**
   * In a CODE file, the columns of each line that are inside a comment.
   *
   * Undefined for prose (Markdown, plain text), where the whole line is the subject and no grammar
   * is consulted at all — that path is unchanged by this feature.
   */
  const commentsByLine = await commentGate(document, lines, scopes);
  if (superseded()) return undefined;

  let slice = performance.now();
  for (const lineNo of lines) {
    // Yield now and then, so a keystroke or a scroll can supersede this pass (see `SLICE_MS`) — and
    // so the check below can ever see one.
    if (performance.now() - slice > SLICE_MS) {
      await yieldToHost();
      slice = performance.now();
    }
    if (superseded()) return undefined;
    // In a code file, everything outside a comment is skipped before it is ever tokenized. A line
    // of code with no comment costs nothing beyond the lookup.
    const comments = commentsByLine?.get(lineNo);
    if (commentsByLine && (comments === undefined || comments.length === 0))
      continue;
    const { text } = document.lineAt(lineNo);
    let colouring = cache.get(text);
    if (colouring === undefined) {
      colouring = await colourLine(text);
      cache.set(text, colouring);
    }
    for (const { category, start, end } of colouring) {
      // Checked on the DOCUMENT columns, after `stripRuby`'s offset map has put them back — the
      // grammar tokenized the real line, so its spans are in the same coordinates.
      if (!comments || within(comments, start, end))
        ranges
          .get(category)
          ?.push(new vscode.Range(lineNo, start, lineNo, end));
    }
  }
  return ranges;
};

/**
 * The comment spans of the lines about to be coloured, or undefined when the whole line counts.
 *
 * Undefined is the PROSE answer, and it is what keeps Markdown and plain text exactly as they were:
 * no grammar is loaded, no tokenizing happens, and the caller's filter short-circuits. A code file
 * whose grammar cannot be resolved gets the same treatment as one with no comments — nothing is
 * coloured — rather than falling back to colouring code.
 */
const commentGate = async (
  document: vscode.TextDocument,
  lines: ReadonlySet<number>,
  scopes: CommentScopes | undefined
): Promise<Map<number, CommentSpan[]> | undefined> => {
  if (isProse(document.languageId)) return undefined;
  if (!scopes || lines.size === 0) return new Map();

  // One contiguous block, because a grammar is stateful: a line's meaning depends on every line
  // above it, so the spans have to be produced in order rather than per visible range.
  const from = Math.min(...lines);
  const to = Math.max(...lines);
  const spans = await scopes.commentSpans(document, from, to);
  const byLine = new Map<number, CommentSpan[]>();
  for (const [index, lineSpans] of spans.entries())
    byLine.set(from + index, lineSpans);
  return byLine;
};

/** Whether `[start, end)` falls entirely inside one of the comment spans. */
const within = (
  comments: readonly CommentSpan[],
  start: number,
  end: number
): boolean => comments.some((span) => start >= span.start && end <= span.end);

/**
 * Owns the decoration types and keeps every visible editor coloured.
 *
 * A single instance lives for the extension's lifetime; `dispose()` releases the decoration types,
 * which is what actually removes the colouring from the screen.
 */
export class PosDecorator {
  #decorations: DecorationSet;
  #paletteId: PaletteId;
  #enabled: boolean;
  #codeComments: boolean;
  /**
   * The generation of each editor's newest pass: a newer pass invalidates an in-flight older one.
   *
   * Keyed by EDITOR, not document. Two editors on one document (a split view) each need their own
   * pass over their own visible lines; keyed by document, the second cancelled the first, and only
   * one of them was ever coloured (audit SM-6).
   */
  readonly #generation = new Map<vscode.TextEditor, number>();
  /** Never reused, so a pass can never mistake a newer generation for its own. */
  #nextGeneration = 0;
  /** Pending `refreshSoon` timers, keyed like `#generation`. */
  readonly #pending = new Map<
    vscode.TextEditor,
    ReturnType<typeof setTimeout>
  >();
  /** Every line's colouring by its text — see `LineCache`. */
  readonly #lines = new LineCache();
  #disposed = false;
  /** Set once a pass has failed and been logged, so a persistent failure logs once. */
  #reportedFailure = false;

  /**
   * The grammar runner, or undefined when this decorator was built without one.
   *
   * Optional so the prose path — and every test that only cares about it — needs no grammar, no
   * WASM and no filesystem. A code file simply goes uncoloured without it.
   */
  readonly #scopes: CommentScopes | undefined;

  constructor(scopes?: CommentScopes) {
    this.#paletteId = readPalette();
    this.#enabled = readEnabled();
    this.#codeComments = codeCommentsEnabled();
    this.#decorations = createDecorations(this.#paletteId);
    this.#scopes = scopes;
  }

  /**
   * Coalesce edits: repaint once the typing pauses, rather than per keystroke.
   *
   * Only the TEXT-CHANGE trigger goes through here. Scrolling and editor visibility stay on
   * `refresh` because there the delay would be visible as uncoloured text the reader is already
   * looking at, whereas mid-word colouring is churn nobody reads.
   *
   * A superseded pass stops within one slice (`SLICE_MS`), so this is about the repaint that lands
   * the moment typing stops, not about runaway work. (This comment used to say the pass stopped
   * "cheaply" when it could not stop at all — audit SM-6.)
   */
  refreshSoon(editor: vscode.TextEditor, delayMs = REFRESH_DELAY_MS): void {
    if (this.#disposed) return;
    clearTimeout(this.#pending.get(editor));
    this.#pending.set(
      editor,
      setTimeout(() => {
        this.#pending.delete(editor);
        void this.refresh(editor);
      }, delayMs)
    );
  }

  /**
   * Re-read configuration. Rebuilds the decoration types only when the PALETTE changed — disposing
   * them is what clears painted ranges, so rebuilding on every unrelated setting edit would make
   * the editor flash.
   */
  onConfigurationChanged(): void {
    const nextPalette = readPalette();
    const nextEnabled = readEnabled();
    const paletteChanged = nextPalette !== this.#paletteId;
    this.#paletteId = nextPalette;
    this.#enabled = nextEnabled;
    this.#codeComments = codeCommentsEnabled();
    if (paletteChanged) {
      this.#disposeDecorations();
      this.#decorations = createDecorations(nextPalette);
    }
    this.refreshAll();
  }

  /** Repaint every visible editor. */
  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      void this.refresh(editor);
    }
  }

  /** Repaint one editor. Safe to call often — an in-flight pass for the same editor is dropped. */
  async refresh(editor: vscode.TextEditor): Promise<void> {
    if (this.#disposed) return;

    if (!this.#enabled || !isDecorated(editor.document)) {
      this.#clear(editor);
      return;
    }
    // A code file needs the separate opt-in AND a grammar. Cleared rather than left alone, so
    // turning the setting off removes colouring that is already on screen.
    const prose = isProse(editor.document.languageId);
    if (!prose && !this.#codeComments) {
      this.#clear(editor);
      return;
    }

    // Generation counter, not a CancellationToken: nothing hands us one here (decorations are
    // pushed, not requested), so supersession is ours to track. A later pass for the same editor
    // takes a newer generation, and any earlier pass still working sees it and abandons its work.
    const generation = ++this.#nextGeneration;
    this.#generation.set(editor, generation);
    const superseded = (): boolean =>
      this.#disposed || this.#generation.get(editor) !== generation;

    // Caught here because every caller discards this promise (`void this.refresh(...)`): a failure
    // in a pass — the tokenizer failing to build is the realistic one — was an unhandled rejection on
    // every scroll and keystroke (audit SM-6). A failed pass leaves the editor as it was, and is
    // logged once rather than on every repaint after it.
    let ranges: Awaited<ReturnType<typeof computeRanges>>;
    try {
      ranges = await computeRanges(
        editor,
        superseded,
        this.#lines,
        prose ? undefined : this.#scopes
      );
    } catch (err) {
      if (!this.#reportedFailure) {
        this.#reportedFailure = true;
        log().warn(`part-of-speech colouring failed: ${String(err)}`);
      }
      return;
    }
    if (ranges === undefined || superseded()) return;
    // Done and still current: forget the editor, so a closed one is not kept alive by this map.
    this.#generation.delete(editor);

    for (const category of PALETTE_CATEGORIES) {
      editor.setDecorations(
        this.#decorations[category],
        ranges.get(category) ?? []
      );
    }
  }

  /** Remove all colouring from one editor without disposing the shared decoration types. */
  #clear(editor: vscode.TextEditor): void {
    for (const category of PALETTE_CATEGORIES) {
      editor.setDecorations(this.#decorations[category], []);
    }
  }

  #disposeDecorations(): void {
    for (const category of PALETTE_CATEGORIES) {
      this.#decorations[category].dispose();
    }
  }

  dispose(): void {
    this.#disposed = true;
    // Before disposing the decoration types: a pending timer would otherwise wake up and call
    // `setDecorations` with types that no longer exist.
    for (const timer of this.#pending.values()) clearTimeout(timer);
    this.#pending.clear();
    this.#disposeDecorations();
    this.#generation.clear();
  }
}

const readEnabled = (): boolean =>
  vscode.workspace
    .getConfiguration("vscode-jisho")
    .get<boolean>("highlighting.enabled", false);

const readPalette = (): PaletteId =>
  vscode.workspace
    .getConfiguration("vscode-jisho")
    .get<PaletteId>("appearance.palette", "standard");
