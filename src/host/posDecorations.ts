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
import { japaneseRuns, stripRuby } from "./hover";
import { hasKanji } from "../shared/japanese";
import { segment } from "./tokenizer";
import {
  PALETTE_CATEGORIES,
  palette,
  type PaletteCategory,
  type PaletteId
} from "../shared/posPalette";

/** Languages we colour. Prose formats — this is a syntax highlighter for text, not for code. */
export const DECORATED_LANGUAGES = ["markdown", "plaintext"];

/**
 * How long typing must pause before the colouring repaints. Long enough to sit between keystrokes
 * at any realistic typing speed — including kana input, where one character is several keystrokes —
 * and short enough that the repaint reads as part of stopping rather than as a lag.
 */
const REFRESH_DELAY_MS = 150;

const isDecorated = (document: vscode.TextDocument): boolean =>
  DECORATED_LANGUAGES.includes(document.languageId);

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

/**
 * Colour one editor's VISIBLE lines.
 *
 * Scoped to `visibleRanges` rather than the whole document because each line costs a tokenizer
 * call — the semantic-token provider this replaces walked every line of the file. A generous
 * margin is added so scrolling a little does not reveal uncoloured text before the next pass.
 */
const computeRanges = async (
  editor: vscode.TextEditor,
  superseded: () => boolean
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

  for (const lineNo of lines) {
    // Checked per line rather than only at the end: a fast typist can supersede this pass several
    // times over, and each line is a tokenizer call we would otherwise waste.
    if (superseded()) return undefined;
    // `"drop"` because this is ANALYSIS, not a rewrite: emphasis markers are removed so
    // `彼に*遅れない*ように` reads as one Japanese run. The offset maps put the ranges back.
    const stripped = stripRuby(document.lineAt(lineNo).text, "drop");
    // Gate on the LINE, not the run. A run is whatever sits between punctuation, so
    // `もしもし、私は…` splits into a kana-only run and a kanji-bearing one — and gating per run
    // would skip もしもし, ゆっくり and every other kana word. That would silently erase the
    // utterance category, which is almost entirely kana (もしもし, ああ, えと).
    //
    // The constraint the gate exists for is real but coarser: a line with NO kanji anywhere is
    // usually not prose the tokenizer can segment reliably (no script transitions to anchor word
    // boundaries on), and wrong colouring teaches wrong boundaries.
    if (!hasKanji(stripped.text)) continue;
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
            const startCol = stripped.starts[offset];
            const endCol = stripped.ends[end - 1];
            ranges
              .get(part.pos)
              ?.push(new vscode.Range(lineNo, startCol, lineNo, endCol));
          }
          offset = end;
        }
      }
    }
  }
  return ranges;
};

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
  /** Per-editor generation counter: a newer pass invalidates an in-flight older one. */
  readonly #generation = new Map<string, number>();
  /** Pending `refreshSoon` timers, keyed like `#generation`. */
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();
  #disposed = false;

  constructor() {
    this.#paletteId = readPalette();
    this.#enabled = readEnabled();
    this.#decorations = createDecorations(this.#paletteId);
  }

  /**
   * Coalesce edits: repaint once the typing pauses, rather than per keystroke.
   *
   * Only the TEXT-CHANGE trigger goes through here. Scrolling and editor visibility stay on
   * `refresh` because there the delay would be visible as uncoloured text the reader is already
   * looking at, whereas mid-word colouring is churn nobody reads.
   *
   * The generation counter already stops a superseded pass cheaply (~3.6ms of an otherwise ~219ms
   * viewport pass), so this is about the repaint that lands the moment typing stops, not about
   * runaway work.
   */
  refreshSoon(editor: vscode.TextEditor, delayMs = REFRESH_DELAY_MS): void {
    if (this.#disposed) return;
    const key = editor.document.uri.toString();
    clearTimeout(this.#pending.get(key));
    this.#pending.set(
      key,
      setTimeout(() => {
        this.#pending.delete(key);
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
    const key = editor.document.uri.toString();

    if (!this.#enabled || !isDecorated(editor.document)) {
      this.#clear(editor);
      return;
    }

    // Generation counter, not a CancellationToken: nothing hands us one here (decorations are
    // pushed, not requested), so supersession is ours to track. A later pass for the same document
    // bumps the counter, and any earlier pass still tokenizing sees it and abandons its work.
    const generation = (this.#generation.get(key) ?? 0) + 1;
    this.#generation.set(key, generation);
    const superseded = (): boolean =>
      this.#disposed || this.#generation.get(key) !== generation;

    const ranges = await computeRanges(editor, superseded);
    if (ranges === undefined || superseded()) return;

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
