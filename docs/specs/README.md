# Implementation handoff specs

Detailed, self-contained specs for the remaining polish/feature work, written for an implementing agent (Opus) picking up mid-project. Each spec records decisions **already made with the user** — do not relitigate them; if a spec conflicts with reality, surface it rather than improvising.

## Read first, always

- [CLAUDE.md](../../CLAUDE.md) — contribution rules. Rule 9 matters most here: tests assert BEHAVIOR and encode WHY (two stroke players shipped broken behind green mechanism-asserting suites).
- [CONVENTIONS.md](../CONVENTIONS.md) — toolchain, theming/contrast standard (oklch everywhere; light-theme verification), packaging.
- [STROKE-ORDER.md](../STROKE-ORDER.md) — the expensive lessons (one delivery path, one clock, registered @property, CSS Modules vs injected DOM).
- [BACKLOG.md](../BACKLOG.md) — each spec references its backlog item; the item carries additional history.

## Working agreements (non-negotiable)

- **Gate + tests before every commit**: `vp check` clean (0 warnings), `vp test --run` green. Wallaby (MCP or `npx -y @wallabyjs/cli run --skill`) for fast feedback.
- **Bumpy bump file per user-facing commit** (`.bumpy/*.md`, written for END USERS, soft-wrapped one line per paragraph).
- **E2E harness safety**: never `browser.close()` over CDP; PID-scoped tree-kill only; port 39871; VS Code pinned "1.128.1"; `checkInnoSetupMutex: vscode-updating is held` in stderr = fatal-but-transient (a pending VS Code update; ask the user), distinct from harmless "mutex already exists".
- **E2E focus traps** (each cost a debugging round): keystrokes/F1 die when focus sits in a webview iframe — click `.editor-group-container` first; the extension only ACTIVATES when the sidebar opens — call `openJishoSidebar()` in standalone tests; every editor owns an empty `.monaco-hover-content` — filter hover assertions by text; Playwright wipes `test-results/` per run.
- **Theming**: all color derivation in oklch; accent text colors constructed via `oklch(from var(--jisho-fg) l C H)` (lightness from the theme's foreground), never srgb blends; every new derived color gets a light-theme capture in `e2e/visual-light.e2e.ts`.
- **Tokenizer constraint** (applies everywhere): pure-kana runs tokenize into garbage (IPADIC needs kanji↔kana script transitions) — features skip them rather than act on bad segmentation.
- **Ruby markup** (`{食|た}べる`, mirrordown syntax — MIT, the user's own project): every editor-text feature must survive it. `stripRuby`/`toStrippedIndex` in `src/host/hover.ts` are the shared machinery; compute in stripped space, map back through `starts`/`ends`.
- **Commit style**: conventional-commit subject, body explains WHY (see `git log`), soft-wrapped, ends with the Co-Authored-By trailer.

## Specs

| #   | Spec                                                                                                            | Backlog | Status                                           |
| --- | --------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------ |
| 01  | [Palette engine: decoration-based POS palettes, 11-way taxonomy, CVD + typeface channels](01-palette-engine.md) | #38     | Ready except palette hex values (user to supply) |
| 02  | [Grammar notes: particles, auxiliaries, conjugation forms](02-grammar-notes.md)                                 | #34     | Ready — content-heavy; user reviews all notes    |
| 03  | [Copy-as variants, Add Furigana, word-under-cursor](03-copy-as-and-furigana.md)                                 | #33     | **Implemented** (see below)                      |
| 04  | [Radical position categories in the picker](04-radical-position-filter.md)                                      | #30     | Ready — needs a dictionary DB rebuild            |
| 05  | [Automated data builds, asset delivery, and update lifecycle](05-asset-delivery.md)                             | #39     | Ready — **last piece before the first release**  |
| 06  | [Web extension viability: asset delivery without a filesystem](06-web-extension.md)                             | #40     | Analysis — viable; deliberately AFTER v1         |
| 07  | [Benchmarking and performance strategy](07-performance.md)                                                      | #41     | Pilot run — benchmark exists and works           |

Not yet specced: the #32/#20 examples restructure, and the visual-regression baseline procedure.

## Spec 03 as built (deviations worth knowing)

- **`useCopyStatus` hook**, not a forked menu component: the existing `CopyButton` used `navigator.clipboard` — exactly the flaky path the spec rejected — so the write moved into a shared hook routed through the host, and both the kanji-page copy button and the new `CopyAsMenu` use it. One clipboard path, one feedback implementation.
- **Copy-as sits per READING line**, not once in the headline: each line pairs a reading with the writings it applies to, so the furigana variants annotate the right pairing (一月 → ひとつき【一月, ひと月】 vs いちげつ【一月】).
- **`resolveWord`** (in `hover.ts`) is the shared helper §4 asked for, taking the run + its groups rather than doing its own tokenizing, so it stays pure and the hover keeps ownership of the async part.
- **Component-project setup file** (`src/webview/__tests__/setup.ts`, wired in `vite.config.ts`): views that reach the bridge failed to LOAD under jsdom once WordDetail imported it. Stubbing `acquireVsCodeApi` once beats a `vi.mock` in every spec.
- **E2E helpers hoisted** in `smoke.e2e.ts` (`runCommand`, `editorWith`) and reused by the spacing/furigana/copy-as tests.
