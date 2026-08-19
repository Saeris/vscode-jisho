/**
 * Clipboard and selection chords for the search box, which a webview does NOT deliver.
 *
 * Two bugs were reported separately and are one problem. Cmd+A selected nothing (#4) and Cmd+V
 * pasted nothing (#7), both on macOS, both in the same contenteditable field.
 *
 * The shared cause is how a webview handles an editing chord. VS Code's host frame calls
 * `preventDefault()` on Cmd/Ctrl+C, V and X before forwarding the press to the workbench, on the
 * promise that it will "dispatch a copy/paste back to the webview if needed" — and it keeps that
 * promise by posting `execCommand` back, which the frame runs as `document.execCommand('paste')`
 * (`webview/browser/pre/index.html`). Electron has since REMOVED `execCommand('paste')`
 * (electron/electron#45277) to match browsers, and VS Code's migration off it
 * ([microsoft/vscode#239228](https://github.com/microsoft/vscode/issues/239228)) still has the
 * webview item unticked. The native paste is suppressed and its replacement no longer runs, so the
 * press does nothing at all. Select All fails one step earlier: it is not in that special-cased set,
 * so on macOS the chord reaches the workbench and runs VS Code's own "Select All" instead of ours.
 *
 * The lesson generalises past these two keys: for an editing chord, a webview can rely on neither
 * the browser default nor VS Code's re-dispatch. Whatever the field needs, the field must do.
 *
 * Paste is therefore delivered as a SYNTHETIC `beforeinput`, not as a hand-written insert. React
 * Aria's TokenField already implements `insertFromPaste` — it replaces the selected range, strips
 * newlines for a single-line field, and re-tokenises any `#tag` in the pasted text — and every one
 * of those behaviours would have to be duplicated, and kept in step, by an insert of our own. The
 * clipboard is read through `navigator.clipboard` rather than `execCommand`, which is the very API
 * being removed; the host frame grants `clipboard-read; clipboard-write;` whenever scripts are
 * enabled, and reading inside a keydown satisfies the user-gesture requirement. Both facts were
 * verified against a running webview — see `e2e/clipboard.e2e.ts`.
 */

/** The editing chord a key event represents, or undefined when it is not one of ours. */
export const editingChord = (
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">
): "selectAll" | "paste" | undefined => {
  // `altKey` is excluded deliberately: Ctrl+Alt is AltGr on a Windows layout, and claiming it would
  // eat characters European keyboards produce with it.
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "a") return "selectAll";
  if (key === "v") return "paste";
  // Copy and cut are deliberately NOT claimed. Only paste was reported broken (#7), and the two
  // ride different mechanisms: the field takes copy and cut through the native `copy`/`cut`
  // clipboard events, which the browser still fires, whereas paste is the one that depended on the
  // `execCommand` half Electron removed. Claiming a working chord to fix a broken one risks the
  // rich token payload copy already carries, so this stays narrow until something says otherwise.
  return undefined;
};

/**
 * Read the clipboard as text, or undefined when there is nothing usable.
 *
 * Never throws. A denied permission, an empty clipboard and a browser without the API are the same
 * to the caller — there is nothing to insert — and a rejection escaping a key handler would surface
 * as an unhandled rejection, which this webview's reporter would then offer to file as a crash.
 */
export const readClipboardText = async (): Promise<string | undefined> => {
  try {
    const text = await navigator.clipboard.readText();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
};

/**
 * Hand `text` to a contenteditable as though the user had pasted it.
 *
 * Returns false when the element rejected the event, which callers treat as "nothing was inserted".
 */
export const insertAsPaste = (target: HTMLElement, text: string): boolean => {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  // `cancelable` matters: the field's handler calls `preventDefault()` to take ownership of the
  // edit, and a non-cancelable event would leave it applying the change AND letting a default run.
  return !target.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "insertFromPaste",
      dataTransfer: data,
      bubbles: true,
      cancelable: true,
      composed: true
    })
  );
};
