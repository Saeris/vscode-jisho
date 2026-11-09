/**
 * The editor-side commands: resolving what word the cursor is on, and rewriting a selection.
 *
 * Kept out of extension.ts because "the word here" has to mean the same thing whether you hover it
 * or right-click it — `targetWord` routes through the hover's own `resolveWord` for exactly that
 * reason, and putting it beside the hover machinery makes the shared dependency visible.
 */
import * as vscode from "vscode";
import {
  groupSegments,
  japaneseRunAt,
  resolveWord,
  stripRuby,
  toStrippedIndex
} from "./hover";
import { hasKanji } from "../shared/japanese";
import { segment } from "./tokenizer";

/**
 * The word the command should act on: the selection when there is one, otherwise the word under
 * the cursor — resolved through the same machinery as the hover, so "the word here" means the
 * same thing whether you hover it or right-click it. Returns the surface as written (speaking a
 * lemma would say a form the user didn't write) with the dictionary form alongside.
 */
export const targetWord = async (): Promise<
  { surface: string; lookup: string } | undefined
> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const selected = editor.document.getText(editor.selection).trim();
  if (selected !== "") return { surface: selected, lookup: selected };

  const position = editor.selection.active;
  const stripped = stripRuby(
    editor.document.lineAt(position.line).text,
    "drop"
  );
  const cursor = toStrippedIndex(stripped, position.character);
  const run = japaneseRunAt(stripped.text, cursor);
  if (run === null) return undefined;
  const groups = hasKanji(run.text)
    ? groupSegments(await segment(run.text))
    : [];
  const { surface, lookup } = resolveWord(run, groups, cursor);
  return { surface, lookup };
};

/**
 * Apply a text transform to the selection (expanded to whole lines, so a partial-line selection
 * can't cut a word) or, with no selection, the whole document.
 */
export const transformEditorText = async (
  transform: (text: string) => Promise<string>
): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  // Twice at most: once on the text as it was, and once more on the text as it is now if that
  // changed while the transform ran.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { document, selection } = editor;
    const version = document.version;
    const range = selection.isEmpty
      ? new vscode.Range(
          0,
          0,
          document.lineCount - 1,
          document.lineAt(document.lineCount - 1).text.length
        )
      : new vscode.Range(
          selection.start.line,
          0,
          selection.end.line,
          document.lineAt(selection.end.line).text.length
        );
    const replaced = await transform(document.getText(range));
    // The transform awaits the tokenizer, so the document can change under it — typing, a
    // formatter, another extension. VS Code then rejects the edit, and that rejection used to be
    // ignored: the command did nothing and said nothing (audit I-12). Redo it on the current text.
    if (document.version !== version) continue;
    if (await applied(editor, range, replaced)) return;
  }
  void vscode.window.showWarningMessage(
    "Jisho: the text changed while it was being rewritten, so it was left as it is. Try the command again."
  );
};

/** Replace `range` with `text`. False when VS Code refuses — a newer version, or a closed editor. */
const applied = async (
  editor: vscode.TextEditor,
  range: vscode.Range,
  text: string
): Promise<boolean> => {
  try {
    return await editor.edit((edit) => {
      edit.replace(range, text);
    });
  } catch {
    // `edit` throws, rather than answering false, on an editor that has been closed.
    return false;
  }
};
