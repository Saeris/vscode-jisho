# Spec 04 — Radical position categories in the picker

**Backlog:** #30, application 1 (application 2 — click-a-region on the stroke page — shipped in 70bfb46). **Blocked on:** nothing, but requires a dictionary DB rebuild (dev + the release DBs at the next dictionary release — see the standing pre-publish handoff list).

## Objective

The Kanji Look & Learn textbook teaches radical lookup through **seven positional categories**: ① left 偏 (hen), ② right 旁 (tsukuri), ③ top 冠 (kanmuri), ④ bottom 脚 (ashi), ⑤ enclosure 構 (kamae), ⑥ upper-left 垂 (tare), ⑦ lower-left 繞 (nyō). The radical picker currently organizes by stroke count only; add a position-category filter so lookup matches how learners are taught.

## The derivation (already validated — do not re-research)

Backlog #30 contains the full validated mapping: AnimCJK `dictionaryJa.txt`'s `acjk` field encodes the first IDC (split geometry) plus WHICH segment carries the `.` radical marker. **18/19 of the textbook's own examples classify correctly; 94% of 7,007 entries are classifiable.** The table (from #30 — trust it, it was verified against KanjiVG's independent `kvg:position` data):

| First IDC               | Radical in first segment | Radical in later segment |
| ----------------------- | ------------------------ | ------------------------ |
| ⿰ (left-right)         | hen (体⿰亻.2本5)        | tsukuri (頭⿰豆7頁.9)    |
| ⿱ (top-bottom)         | kanmuri                  | ashi                     |
| ⿴⿵⿶⿷⿻ (enclosures) | kamae                    | kamae                    |
| ⿸⿹ (upper corner)     | tare                     | tare                     |
| ⿺ (lower-left)         | nyō                      | nyō                      |

Unclassifiable (≈6%, e.g. `見.⿱目5儿2` — the character IS its own radical): `null`, no category. That is a real distinction, not a gap.

## Architecture

### 1. Shared acjk module (`scripts/acjk.ts`)

`parseAcjk` currently lives in `scripts/build-strokes.ts` (exported, unit-tested). Extract it plus a new pure `radicalPosition(character, acjk): Position | null` into `scripts/acjk.ts`; both build scripts import from there. `radicalPosition` needs what `parseAcjk` currently discards: the FIRST IDC character and which segment index carries the `.` marker — extend the parser's return (or add a light second parse) rather than duplicating the tokenization. Keep `build-strokes.ts`'s existing tests passing unchanged (move, don't rewrite).

`Position = "hen" | "tsukuri" | "kanmuri" | "ashi" | "kamae" | "tare" | "nyo"`.

### 2. Data build (`scripts/build-data.ts`, `src/data/schema.sql`)

- `radicals` table gains `position TEXT NULL`.
- build-data fetches `dictionaryJa.txt` at the SAME pinned `ANIMCJK_SHA` (import the constant from `scripts/acjk.ts` — one pin, two consumers; a drift between the scripts would classify against different data than the stroke SVGs ship).
- Per-radical category = **majority vote** of `radicalPosition` across all kanji whose acjk marks that radical (a radical's position is nearly always fixed — 亻 is always hen — but the vote absorbs the odd irregular entry). Radicals with no votes: NULL.
- Licensing: this is APL-derived factual data like the stroke SVGs; ARPHICPL attribution already ships — add a `radicalPositionSource` meta row mirroring `strokeSource`.
- Rebuild `assets/jisho.db` (`vp run build:data`); note the release-DB rebuild on the standing handoff list.

### 3. DTO + host (`src/shared/messages.ts`, `src/host/db.ts`)

`RadicalDto` gains `position: string | null`; `lookupRadicals` SELECTs it. db.spec: spot-check the built DB (亻→hen, 宀→kanmuri, ⻌→nyo, 囗→kamae).

### 4. Picker UI (`src/webview/views/RadicalPicker.tsx`)

- A filter chip row above the radical grid: the seven categories as toggles — label each `偏 hen`-style (JA term + romaji; the textbook teaches the JA terms) — plus implicit "all" when none is toggled. Single-select toggle (tapping the active chip clears it); multi-select adds complexity the lookup flow doesn't need.
- Filtering hides non-matching radicals in the grid (including NULL-position radicals when a filter is active). It does NOT change the selection semantics — selected radicals stay selected even if filtered out of view (mirror the existing `enabled` greying behavior; check how the picker renders disabled radicals and follow it).
- The chips belong in webview state (plain useState — this is view-local UI state, not navigation).
- Term tooltips: add the seven category terms to the glossary surface (one-liners: "hen — radical on the left side, like 亻 in 体"). If spec 02 has landed, put them in `FORM_NOTES`-style grammar data; otherwise Term's local GLOSSARY.

## Test plan (behavior-first)

- **Unit (`scripts/__tests__/acjk.spec.ts`)**: the textbook examples from #30 — 体→hen, 頭→tsukuri, 広→tare, 道→nyō, 国→kamae (split-segment enclosure!), 聞→kamae, plus 見→null (self-radical). Use real acjk strings from #30/the probe logs, not invented ones.
- **DB (`db.spec.ts`)**: the spot-checks above, plus "every non-null position is one of the seven values".
- **Component**: picker filter behavior — toggling 冠 hides 亻 and shows 宀; toggling again restores all; a selected radical survives being filtered from view.
- **E2E capture**: extend the existing picker capture (if one exists in visual.e2e.ts — check; else add) with a filtered state for the visual pass.

## Verification loop

`vp check` → `vp run build:data` (≈minutes; verify the summary line reports position coverage) → `vp test --run` → `vp pack && vp build` → picker captures → bump file → commit. Remember: the DB grew a column — old release DBs lack it; `lookupRadicals` must tolerate the column's absence (NULL-safe SELECT or a PRAGMA check) OR the ensureDatabase version gate must force re-download — check how previous schema changes were handled (`meta` versioning) and follow that precedent.

## Out of scope

Position categories on KanjiDetail ("radical: ⻌ nyō" line — nice, small, but a separate polish item); #27 tag-search integration (`#hen`); KanjiVG cross-checking (CC BY-SA — reference only, never merged).
