/**
 * Which key presses the field takes over from the webview.
 *
 * The consequences of getting this set wrong are asymmetric, so both directions are tested. Claiming
 * too little leaves #4/#7 unfixed; claiming too much silently breaks a key that worked — and the
 * `Ctrl+Alt` case below is a real keyboard layout, not a hypothetical.
 */
import { describe, expect, it } from "vitest";
import { editingChord, insertAsPaste } from "../webviewShortcuts";

/** A keydown as `editingChord` reads it. */
const press = (
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {}
): Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey"> => ({
  key,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false
});

describe("editing chords", () => {
  it("claims Select All and Paste on both platform modifiers", () => {
    // WHY: the reports are macOS (Cmd), but the same interception applies to Ctrl on Windows and
    // Linux — and the field must not depend on which one the user pressed.
    expect(editingChord(press("a", { meta: true }))).toBe("selectAll");
    expect(editingChord(press("a", { ctrl: true }))).toBe("selectAll");
    expect(editingChord(press("v", { meta: true }))).toBe("paste");
    expect(editingChord(press("v", { ctrl: true }))).toBe("paste");
  });

  it("matches a capital letter, so Shift does not defeat the chord", () => {
    // WHY: `key` reports "A" when Shift is held or Caps Lock is on. Comparing case-sensitively
    // would make the fix mysteriously stop working for a user with Caps Lock on.
    expect(editingChord(press("A", { meta: true }))).toBe("selectAll");
    expect(editingChord(press("V", { ctrl: true }))).toBe("paste");
  });

  it("leaves copy and cut alone", () => {
    // WHY: only paste was reported broken. Copy and cut ride the native `copy`/`cut` clipboard
    // events, which still fire, and the field uses them to carry a rich token payload. Taking them
    // over would replace something that works with something that could break.
    expect(editingChord(press("c", { meta: true }))).toBeUndefined();
    expect(editingChord(press("x", { meta: true }))).toBeUndefined();
  });

  it("ignores Ctrl+Alt, which is AltGr on a European layout", () => {
    // WHY: AltGr is Ctrl+Alt. On a German or Polish layout it types real characters, so claiming
    // this combination would swallow input for those users to fix a bug they do not have.
    expect(editingChord(press("a", { ctrl: true, alt: true }))).toBeUndefined();
    expect(editingChord(press("v", { ctrl: true, alt: true }))).toBeUndefined();
  });

  it("ignores an unmodified key", () => {
    // WHY: the field is a text box. Typing "a" must insert "a".
    expect(editingChord(press("a"))).toBeUndefined();
    expect(editingChord(press("v"))).toBeUndefined();
  });
});

describe("paste delivery", () => {
  it("re-delivers the clipboard as the beforeinput the field already implements", () => {
    // WHY: the alternative is hand-writing the insert, which would have to duplicate React Aria's
    // range replacement, newline stripping and `#tag` re-tokenising — and keep them in step. This
    // asserts the SHAPE the field's own handler switches on, since that is the contract.
    const target = document.createElement("div");
    let seen: InputEvent | undefined;
    target.addEventListener("beforeinput", (e) => {
      seen = e;
      e.preventDefault();
    });

    const inserted = insertAsPaste(target, "ある日");

    expect(inserted).toBe(true);
    expect(seen?.inputType).toBe("insertFromPaste");
    expect(seen?.dataTransfer?.getData("text/plain")).toBe("ある日");
  });

  it("reports failure when nothing consumed the event", () => {
    // WHY: an unhandled paste means the text did not land. The caller can only tell the difference
    // if this says so, and a silent false success is how a paste bug survives a green suite.
    const target = document.createElement("div");
    expect(insertAsPaste(target, "ある日")).toBe(false);
  });
});
