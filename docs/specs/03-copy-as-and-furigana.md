# Spec 03 — Copy-as variants, Add Furigana, word-under-cursor lookup

**Backlog:** #33 (remainder). **Blocked on:** nothing. The ruby-alignment utility is the cornerstone — build and test it first; everything else consumes it.

## Objective

Three authoring integrations the user requested (they write Japanese course material in markdown with mirrordown ruby syntax):

1. **Copy as…** on the word page (Mintlify/Figma-style): plain / kana / romaji / ruby markdown / HTML ruby.
2. **Add Furigana to Selection** editor command: tokenize the selection and wrap kanji-bearing words in `{漢字|かんじ}` ruby syntax (this subsumes the earlier "Paste with furigana" idea — copy-as covers export, this covers annotating text in place).
3. **Word under cursor**: "Look Up Selection" / "Speak Selection" work with an empty selection by resolving the word at the cursor.

## 1. Ruby alignment utility (`src/shared/ruby.ts`)

The correctness core: given a surface and its kana reading, wrap only the KANJI runs — `{食|た}べる`, never `{食べる|たべる}`.

```ts
/** Pairs each kanji run with its reading span; null when alignment fails. */
export const alignReading = (
  surface: string,
  reading: string // hiragana
): Array<{ text: string; ruby?: string }> | null;

export const toRubyMarkdown = (surface, reading): string; // {食|た}べる; whole-word {surface|reading} fallback on null
export const toRubyHtml = (surface, reading): string;     // <ruby>食<rt>た</rt></ruby>べる; same fallback
```

**Algorithm** (the standard okurigana-alignment technique): split the surface into alternating kanji/kana runs; build an anchored regex where each kanji run becomes a lazy capture `(.+?)` and each kana run matches literally (normalize katakana→hiragana on both sides first — wanakana is already a dependency); match against the reading; captures pair with kanji runs. Ambiguity note: lazy captures can mis-split readings across ADJACENT kanji runs separated by kana (rare); acceptable for v1 — the fallback and the user's editing pass cover it. Fail (return null) when the regex doesn't match.

**Tests (unit, the important ones):** 食べる/たべる → `{食|た}べる`; 日本語/にほんご → `{日本語|にほんご}`; 買い物/かいもの → `{買|か}い{物|もの}`; 取り扱い/とりあつかい → `{取|と}り{扱|あつか}い`; katakana surface (コーヒー) → no wrapping; kana-only → unchanged; mismatched reading → whole-word fallback. Round-trip: `stripRuby(toRubyMarkdown(s, r)).text === s` (reuses hover.ts machinery — behavior tie between the writer and every reader).

## 2. Copy as… on the word page

- **Clipboard via the HOST, not `navigator.clipboard`** (webview clipboard permissions are flaky): new request/response pair `copyText { text }` → `vscode.env.clipboard.writeText` → ack. Follow the `openSettings` request precedent exactly (messages.ts unions + `WordRequest` Exclude + `#handle` branch + bridge function).
- UI: a copy affordance in the WordDetail headline area — React Aria `MenuTrigger` (already themed patterns exist; keep it a small ⧉ icon button next to the PlayButton) with items:
  - Word — headword as-is (食べる)
  - Reading — primary kana (たべる)
  - Romaji — `wanakana.toRomaji(reading)`
  - Ruby (Markdown) — `toRubyMarkdown(headword, primaryReading)`
  - Ruby (HTML) — `toRubyHtml(...)`
- After copy, brief confirmation (reuse whatever the existing CopyButton on KanjiDetail does — check it first; extend rather than fork if it can take a menu).

## 3. Add Furigana to Selection (`vscode-jisho.addFurigana`)

- Same shape as the spacing commands (`transformEditorText` in extension.ts): selection expanded to whole lines, or whole document.
- Per line: `stripRuby` FIRST — text already carrying ruby must not be double-wrapped; operate only on segments whose original span contains no `{` (simplest guard: run on the stripped text and skip any group whose original span differs from its stripped length — meaning it overlapped markup).
- Per kanji-bearing run: `segment()` → per GROUP (conjugations whole): reading = concatenated morpheme readings, katakana→hiragana → `toRubyMarkdown(groupSurface, reading)`; splice via the stripRuby maps (right-to-left like `addSpacingToLine`).
- **Tokenizer gap to fix en route**: the fold in `tokenizer.ts` appends `surface` but NOT `reading` for folded auxiliaries — `DetailedSegment.reading` is the head's reading only. Append readings during the fold (`prev.reading += token.reading` when not `"*"`), or concatenate from `parts` (which would need reading on `MorphemeDto`). Either way, add a unit probe: segment("見せました")[0].reading covers ミセマシタ, not just ミセ.
- Commands + menu: palette (`Jisho: Add Furigana`) + editor submenu group `2_spacing@3`. A `removeFurigana` inverse is nearly free (`stripRuby(line).text`) — include it (`@4`).
- E2E (smoke, palette-driven like the spacing test): `写真を見せました` → Add Furigana → `{写真|しゃしん}を{見|み}せました` visible in the editor; Remove Furigana restores.

## 4. Word under cursor

- `selectionText()` in extension.ts: when the selection is empty, resolve via the hover machinery — active editor position → `stripRuby`/`toStrippedIndex`/`japaneseRunAt`/`segment`/`groupSegments`/`wordAt` → the group's surface (lookup) — exactly the hover's word resolution; extract that resolution into a shared helper in `hover.ts` (`wordAtPosition(line, character)` returning `{ surface, lookup }`) so hover and commands cannot diverge.
- Menu `when` clauses: drop `editorHasSelection` from the submenu so the commands appear on plain right-click too (the submenu gates on nothing; individual commands no-op gracefully when no word is found).
- Speak with no selection speaks the resolved word's SURFACE (the conjugated form, not the lemma).

## Verification loop

`vp check` → `vp test --run` → `vp pack && vp build` → `vp exec playwright test smoke.e2e.ts` (copy-as asserted by pasting back into an editor with Ctrl+V and checking the text — clipboard READ from Playwright is unreliable, paste is not) → bump file → commit.

## Out of scope

Furigana display in the sidebar (#15 — needs the JMdict furigana asset for dictionary-grade spans; this spec's algorithmic alignment is for AUTHORING, where the user reviews output); sentence Examples restructure (#20); pitch/marker preservation in copies.
