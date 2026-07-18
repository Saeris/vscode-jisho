# Spec 01 — Palette engine: decoration-based POS palettes, 11-way taxonomy, CVD + typeface channels

**Backlog:** #38 (round 2). **Blocked on:** the user's palette hex values (requested 2026-07-18) — everything else is buildable now with clearly-marked provisional values.

## Objective

The shipped POS semantic highlighting (`vscode-jisho.highlighting.enabled`, commit 539f279) colors Japanese by part of speech using built-in semantic token types, so it inherits the editor theme. The user — who teaches a Japanese course — authored a purpose-built POS palette for their slide decks (11 categories, light + dark variants, designed toward color-vision-deficiency friendliness) and wants it available as a palette mode, with CVD accessibility as a first-class requirement: "simply hooking into themes doesn't serve all of our users."

## Decisions already made (do not relitigate)

1. **Vehicle: text editor decorations, NOT semantic tokens.** Semantic token colors come from themes; static `configurationDefaults` on `editor.semanticTokenColorCustomizations` was evaluated and rejected (no runtime palette switching — fatal for CVD variants — and user-level customizations clobber the whole object). `DecorationRenderOptions` natively supports `light:`/`dark:` variants (maps 1:1 onto the user's two-variant palette) plus `fontWeight`/`textDecoration`.
2. **Theme mode stays the default.** `vscode-jisho.highlighting.palette`: `"theme"` (current semantic-token path) | `"jisho"` (the user's palette) | CVD variants as authored (e.g. `"deuteranopia"`…, added as palette DATA, not code). Master toggle `highlighting.enabled` still gates everything.
3. **Non-color channels are the primary CVD answer**: per-POS `fontWeight`/`textDecoration` survive every deficiency including monochromacy. Palettes may specify them; CVD variants lean on them harder.
4. **Typeface channel (from the Monaspace evaluation, backlog #38):** palette entries MAY carry a font-family stack. Monaspace itself has no CJK glyphs and VS Code cannot mix families in the editor — so: webview surfaces only (SegmentBar) for now; editor-side font-family via the `textDecoration: "none; font-family: …"` CSS hack is EXPERIMENTAL and must not ship enabled. The Japanese "superfamily" = classical type classes (Gothic / Mincho / Maru / 教科書体 — kyōkasho-tai additionally teaches correct handwritten letterforms). CJK's uniform em square makes metric compatibility a non-issue.
5. **Taxonomy extends from 7 to 11 categories** to match the palette: add `pronoun`, `adnominal`, `adjectivalNoun`, `conjunction`, `interjection` to `PartOfSpeech`.
6. **One palette, two surfaces**: the SegmentBar (search breakdown chips) adopts the same palette as the editor.

## Architecture

### 1. Taxonomy (`src/shared/messages.ts`, `src/host/tokenizer.ts`)

Extend the `PartOfSpeech` union with the five new members. In `tokenizer.ts`, the split needs IPADIC's `partOfSpeechSubcategory1` (already on the token type, see `lindera.d.ts`):

- `名詞` + subcategory `代名詞` → `pronoun`
- `名詞` + subcategory `形容動詞語幹` → `adjectivalNoun`
- `連体詞` → `adnominal` (currently mapped to `adjective` — change it)
- `接続詞` → `conjunction`, `感動詞` → `interjection` (both currently `other`)

**Ripples to update:**

- `POS_TOKEN`/`POS_TOKEN_TYPES` in `src/extension.ts` (semantic/theme mode): give the new categories built-in token types (suggest: pronoun→`parameter`, adnominal→`decorator`, adjectivalNoun→`enumMember`, conjunction→`keyword`, interjection→`string` — verify visually and adjust; this mapping is explicitly a taste call the user will review).
- `SegmentBar` chip coloring: find its `data-pos` / `--pos-color` CSS rules and add the new values (interim colors fine until the palette lands there).
- `analyzeQuery` in extension.ts filters `particle`/`auxiliary` — unaffected, but confirm `conjunction`/`interjection` still COUNT as content segments (they should; leave the filter as-is).
- Unit tests: probe the real tokenizer (cheap — see `spacing.spec.ts` precedent): 私→pronoun, この→adnominal, きれい(な)→adjectivalNoun, そして→conjunction, ええと/あら→interjection. Assert `segment()` output pos.

### 2. Palette data (`src/shared/palettes.ts` — shared: host decorations + webview chips)

```ts
export interface PosStyle {
  light: string; // hex for light themes
  dark: string; // hex for dark themes
  fontWeight?: "bold";
  textDecoration?: string; // e.g. "underline"
  fontFamily?: string; // webview-only channel for now (see decision 4)
}
export type PaletteId = "theme" | "jisho"; // CVD ids appended as authored
export const PALETTES: Record<
  Exclude<PaletteId, "theme">,
  Partial<Record<PartOfSpeech, PosStyle>>
> = {
  jisho: {
    /* user-supplied values */
  }
};
```

**Values:** the user supplies the `jisho` palette (11 categories × light/dark). Their category names map: pronoun, noun, adnominal, adjectival noun (=な-adjective stem), adjective, particle, adverb, conjunction, interjection, verb, auxiliary verb. If implementation starts before values arrive, use obviously-wrong placeholders (e.g. all magenta) so nobody mistakes them for the real palette — do NOT eyeball from the screenshots in the conversation history; the palette is deliberately CVD-tuned and drift defeats its purpose.

### 3. Decoration engine (`src/host/decorations.ts`)

- Refactor the POS walk out of `provideSemanticTokens` (extension.ts) into a shared `posRanges(document): Promise<Map<PartOfSpeech, vscode.Range[]>>` — identical logic: per line, `stripRuby`, `japaneseRuns`, skip kanji-less runs, `segment()`, iterate `seg.parts` morphemes, map ranges back via `starts`/`ends`. Both modes consume it (single source; a divergence bug here would color differently per mode).
- Manager lifecycle:
  - Build one `TextEditorDecorationType` per POS from the active palette (`{ light: { color }, dark: { color }, fontWeight, textDecoration }`). Dispose + rebuild on palette change (decoration types are immutable).
  - Apply to `vscode.window.visibleTextEditors` whose language is markdown/plaintext: on activation, `onDidChangeVisibleTextEditors`, `onDidChangeTextDocument` (debounce ~300ms per document), and the existing `onDidChangeConfiguration` listener (which already fires `semanticTokensChanged`).
  - When mode is `"theme"` or highlighting is disabled: clear all decorations (`setDecorations(type, [])`). When a palette is active, `provideSemanticTokens` must return the EMPTY build (double-coloring guard).
- Perf guardrails: visible editors only; skip absurd lines (> ~2,000 chars); the tokenizer is already lazy and cached.

### 4. Webview surface (SegmentBar)

Extend the existing `hostSettings` push (`HostSettings["settings"]`) with the active palette id; `applySettings` (`src/webview/settings.ts`) sets `--pos-color-<category>` custom properties on the root from `PALETTES`. Light/dark selection: VS Code stamps `.vscode-light`/`.vscode-dark`/`.vscode-high-contrast` on the webview body — push both values and let CSS pick. SegmentBar CSS falls back to its current colors when the vars are unset (theme mode).

### 5. Settings (`package.json`)

`vscode-jisho.highlighting.palette`: string enum, default `"theme"`, enumDescriptions explaining each (call the jisho palette "Jisho (designed for Japanese text, color-vision-deficiency friendly)"). CVD variants appear in the enum only when their data exists.

## Test plan (behavior-first)

- **Unit**: taxonomy probes (above); `posRanges` on a crafted line with ruby + conjugation (fixture style of `hover.spec.ts` — e.g. `{写真|しゃしん}を見せました` yields noun/particle/verb/auxiliary ranges with ruby-widened spans).
- **E2E (`e2e/settings.e2e.ts`)**: it already launches with overridden settings — add `"vscode-jisho.highlighting.palette": "jisho"` and assert an editor span's computed color EQUALS the palette's dark hex for its POS (decorations render as inline styles — checkable, unlike theme mode). Theme mode keeps its existing coverage; assert one mode per launch (flipping settings mid-E2E through the UI is unreliable).
- **Light theme**: add a palette capture/assertion to `e2e/visual-light.e2e.ts` proving the `light:` variant renders.
- **Round-trip sanity**: with the palette active then disabled via a fresh launch, palette-colored span count is 0 (decorations cleared).

## Verification loop

`vp check` → `vp test --run` → `vp pack && vp build` → `vp exec playwright test settings.e2e.ts smoke.e2e.ts` → review captures → bump file → commit.

## Out of scope

Editor-side fontFamily injection (experimental hack — do not ship); Monaspace bundling; automatic CVD detection; user-defined custom palette JSON (future setting; the architecture already supports it as data).
