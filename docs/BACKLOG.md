# Backlog

Search-quality and UX improvements observed during M1 testing, ordered roughly by increasing complexity. Tackle one layer at a time. Each item notes its root cause and whether it's a fix (existing behavior is wrong) or a feature (new capability).

> **Milestone 2 = Search quality** ([M2-PLAN.md](M2-PLAN.md)) scopes items **#1 (relevance ranking)**, **#6 (persist on back)**, **#2 (deinflection)**, and **#7 (tap-through)** — the refinements that need no new dataset. Item **#5** (kanji-as-first-class) is scheduled as **M4**, and **#3/#4** (tokenizer, multi-word) as **M5** — see [ROADMAP.md](ROADMAP.md) for the full sequence.

## Search relevance & matching

### 1. Rank results by relevance, not just match tier (fix)

Results are currently ordered `exact > prefix > substring` on raw terms, with common-first only as a tiebreak. This buries the obvious answer: searching "to study" does not surface 勉強する near the top, because "study" appears as a substring in many glosses before it appears as a standalone sense.

**Approach:** add a relevance score. Signals to weight: whole-word gloss match > substring; match on the _first_ gloss of the _first_ sense > a later sense; shorter headword (more likely the base word) > longer; common flag; exact reading/kanji match. Score in SQL or in the query layer (`src/host/db.ts` `search`), then order by score. This is the highest-leverage fix — it improves every query.

### 2. Deinflection: match conjugated input to dictionary forms (feature)

`はなします` / `hanashimasu` returns nothing, because JMdict stores the dictionary form (話す / はなし) and our `LIKE` only matches literal terms. Learners search inflected forms constantly.

**Approach:** a deinflection pass on the query before searching — strip common verb/adjective conjugations (-ます, -ました, -て, -ない, -た, -れる, い→く, etc.) to candidate dictionary forms, then search each. Reference implementations: Yomitan/10ten's deinflection rule tables (well-tested, MIT-ish). This is a bounded, rule-based transform — no ML needed. Runs in the query layer.

### 3. Multi-word queries: search each segment (feature, depends on #4)

Like Shirabe, entering multiple words (`日本語 を 勉強 します`) should return the closest matches for _each_ segment, not treat the whole string as one term. Naively splitting on spaces/particles helps, but robust segmentation of unspaced Japanese needs a tokenizer (see #4).

## Kanji as a first-class result type

### 4. Japanese tokenization / morphological analysis (feature — largest item)

`日本語を勉強します` should break into 日本語 / を / 勉強 / します with parts of speech, so the user can focus on individual vocabulary — the jisho.org-style breakdown (see the reference screenshot in the conversation). This is the enabler for #3 and a better #2, and it's the biggest single piece of work here.

**Approach:** use the author's own maintained TypeScript port of kuromoji — [@saeris/kuromoji](https://github.com/Saeris/kuromoji) — rather than the unmaintained upstream kuromoji.js. It's typed, controlled by us, and already proven in [@saeris/remark-ayaji](https://github.com/Saeris/remark-ayaji) (a remark plugin that uses it to auto-generate furigana), which exercises the same tokenize-Japanese-text path we need here. Reuse that integration as the reference. Remaining unknowns to check: IPADIC dictionary size and how it's delivered (bundled vs. loaded), tokenizer startup cost, and whether it runs cleanly in the VSCode extension host (and later the WASM/web-extension target). Runs in the host, feeds POS-segmented terms to the search + the breakdown UI.

### 5. Separate kanji search results from vocabulary (feature)

Searching a single kanji currently returns the closest _vocabulary_ term containing it, not a definition of the _character_ itself. Both Shirabe and jisho.org treat vocab and kanji as distinct result types (a mixed list with separate sections).

**Approach:** add **Kanjidic2** (already available via jmdict-simplified, and in scope from the original plan) to the data build — a `kanji_characters` table with readings (on/kun), meanings, stroke count, grade, JLPT level, radicals. Split search results into "Words" and "Kanji" sections in the webview. This is the natural next dataset to add and unlocks the eventual kanji-detail view.

## Navigation & interaction UX

### 6. Persist search state across back navigation (fix)

Clicking "Back" from a word detail returns to an empty search — the query text and results are lost. The search view should restore its prior query and scroll position.

**Approach:** the XState navigation machine already models a view stack; carry the search query (and ideally scroll offset) in the machine context (or lift the search query state above the view switch in `App.tsx`) so it survives the push/pop. Small, self-contained; good candidate to pair with any of the above.

### 7. Tap-through on glosses / cross-references / example terms (feature)

Shirabe lets you tap a term within a definition, cross-reference, or example sentence to search for it. Our detail view already _renders_ cross-references (`related`/`antonym`) but they aren't interactive. Make xref terms (and eventually gloss words / example vocabulary) clickable to trigger a new search or open that word.

**Approach:** render xrefs as buttons that dispatch `openWord`/a new search via the navigation machine. Note Shirabe's own weakness here — it doesn't clearly signal what's tappable; we can do better with subtle affordances (underline/hover). Depends on nothing else; can follow #6.

### 8. Harden the deinflection rule table (refinement of #2 as shipped in M2) — largely superseded by M5

**Update (M5):** the Lindera tokenizer now supplies accurate dictionary-form lemmas for Japanese queries, feeding search's deinflection merge (`Dictionary.search`'s `extraLemmas`). `deinflect.ts` remains only as the fallback for tokenizer-not-ready and the romaji→kana path — so the motivation for a big type-level rewrite is largely gone. Leave `deinflect.ts` as-is unless the fallback path shows real gaps. Original notes retained below for reference.

The shipped `src/host/deinflect.ts` is a hand-maintained suffix-rewrite array — nothing structurally prevents a missing row (the する/くる irregulars were in fact initially missed). Two ideas modeled on [typed-japanese](https://github.com/typedgrammar/typed-japanese), which encodes Japanese grammar rules in TypeScript's type system:

- **Type-level exhaustiveness:** restructure the rule table as mapped types over closed sets (godan endings う|く|ぐ|す|つ|ぬ|ぶ|む|る × form families), so the compiler rejects an incomplete matrix instead of a test hopefully catching it.
- **Round-trip property tests:** implement (or borrow) a small _forward_ conjugator for known verbs across every (class, form) pair and assert `deinflect()` recovers each dictionary form — replacing hand-picked examples with systematic coverage.

Caveat: typed-japanese self-reports LLM-generated rules with possible inaccuracies — use it as a structural model; Yomitan's tables stay the correctness reference. Superseded eventually by M5's tokenizer, so weigh effort accordingly.

**2026-07-17:** the forward conjugator now exists (`src/webview/conjugate.ts`, #19) and the round-trip test with `deinflect()` runs in CI — it already caught a missing させる→す rule. The user flagged typed-japanese as the natural comparison for `conjugate.ts` specifically; agreed the structural alignment is there (its type-level conjugation matrix ≈ our `GODAN` row table) but a mapped-type exhaustiveness refactor isn't worth it while the runtime table is this small and the round-trip test covers the seams. Revisit only if the table grows form families.

## Post-M4 UX feedback (from testing the kanji features)

### 9. Escape hatch back to search root (fix — small)

Link-driven navigation (word → kanji → component kanji → word → …) builds a deep stack that's tedious to Back out of. The navigation machine already has a `home`/`reset` action (collapses the stack to `search`) — it just needs a UI affordance. Add a persistent "home"/breadcrumb control in detail-view headers (a 🏠 or the app title as a button) dispatching `home`. Consider showing it only when `canGoBack` and stack depth > 1. Trivial; independent.

### 10. Jargon tooltips (feature — small)

Dictionary terminology is opaque to newcomers (the user hadn't seen "nanori"). Add hover tooltips to non-obvious labels — start with **on / kun / nanori** in `KanjiDetail`, apply sparingly elsewhere as more are found. Implementation: a small `<Term>` component (React Aria `Tooltip` + `TooltipTrigger`, which we already have via react-aria-components) wrapping the label with a definition string; theme-aware. A tiny glossary map keeps definitions in one place.

**2026-07-17:** conjugation-form labels added to the glossary — each of the table's 15 form names now carries a short when-you'd-use-it hint ("Te-form — the connector…"), since the terminology alone doesn't say when a form is common.

### 11. Dictionary-aware suggestion strip (feature — large) — DEFERRED; viable, pending a cross-OS spike (verdict corrected M5)

A horizontal suggestion strip above/below the search field showing candidates as the user types, navigable with arrow keys, so a learner can pick the word they mean without fully committing an OS-IME conversion. Originally framed after the Duolingo iOS UX (reference screenshot in the conversation): move into the strip, exact input available, arrow between candidates, underline the current word being suggested-on, reserve space to avoid layout shift.

**Verdict (corrected M5, 2026-07): viable as an _app-rendered_ strip — it does NOT need to override the OS IME.** The original M5 verdict conflated two separate claims and got one wrong:

- **Still true:** we cannot replace or suppress the **OS IME candidate window** (the numbered `1 日本語 / 2 にほんご / 3 ニホンゴ` list Windows MS-IME draws on Space). IME composition `beforeinput` events are non-cancelable ([Input Events spec](https://w3c.github.io/input-events/)); `chrome.input.ime` is ChromeOS-extension-only. Duolingo's _replacement_ IME works only because it's a native iOS app.
- **Wrong before, now corrected:** "no app-rendered suggestions are possible in a webview." They are — the feature never needed the OS IME at all. (An earlier revision of this note mis-attributed the difference to "Monaco's app-drawn completion widget"; that was wrong. Both the typeahead popup seen in a Markdown editor _and_ the Space-triggered candidate list are **OS-drawn IME windows** — the difference is which Windows text framework the host app uses, researched below.)

**Why our search field looks "dumber" than a native text field (researched M5, 2026-07, on Windows 10):** Windows has two IME windows, both OS-drawn ([Microsoft Japanese IME docs](https://learn.microsoft.com/en-us/globalization/input/japanese-ime)):

- the **prediction candidate window** — typeahead suggestions that appear _as you type_, part of Windows "text intelligence";
- the **conversion candidate window** — the numbered `1/2/3` list you Tab/Space into.

Which of these an app gets depends on whether it talks to the IME via **TSF** (Text Services Framework, modern/COM) or **IMM32** (legacy). TSF apps get text intelligence — prediction-as-you-type, autocorrect, reconversion; IMM32 apps get composition + the Space conversion window only. **Chromium uses IMM32, not TSF** ([MS Edge TSF1 explainer](https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/TSF1/explainer.md): "text suggestions as you type … unavailable" under IMM32; TSF support is a still-open Chromium request, [crbug 657623](https://bugs.chromium.org/p/chromium/issues/detail?id=657623)). Electron and every VS Code webview are Chromium, so a web `<input>` in our view **structurally cannot** show the Windows prediction/typeahead window — only the Space conversion window. That's the difference the F5 screenshots captured; it's a Chromium limitation we can't fix.

So the buildable feature is **our own suggestion strip (a normal React/DOM component) populated from our dictionary, appearing on input, navigated with arrow keys** — which owes nothing to TSF, IMM32, or the OS IME. It's just app UI, like any website autocomplete dropdown; it coexists with the OS IME because it isn't an IME. On Windows the keys are free: arrows do not trigger the OS IME, and Space (which does) stays the OS IME's.

**Remaining unknown before building (the real reason it's still deferred):** cross-OS input-event coexistence. Windows behavior is confirmed; **macOS** (Kotoeri/Google IME) and **Linux** (Fcitx/IBus) bind composition/candidate-navigation keys differently — some bind Space _and_ arrows during composition — so the strip's key bindings must be verified not to collide mid-composition on each platform, and it should populate from committed text / the composition buffer without racing `compositionstart`/`compositionend` (reading those events is fine; they need not be cancelable). That's a small real spike on mac/Linux, not a feasibility blocker. Fallback value note still stands: for romaji-typed-without-an-IME, existing romaji search + tokenizer deinflection already resolve the word, so weigh the effort against that.

### 12. Arrow-key navigation between search box and results (fix — medium)

Complement #11's ↑-into-suggestions with **↓ from the search box moving focus into the results list** (today reaching results needs several Tabs past the 部/ⓘ buttons). In the results list, ↑/↓ move through items; ↑ at the top (or Esc) returns focus to the input. Pairs naturally with #11 as one keyboard-navigation model. React Aria's ListBox already handles intra-list arrows; the piece to add is the input↔list focus hand-off.

### 13. Pronunciation text-to-speech (feature — medium) — ✅ shipped in the M4.5 pass

Play buttons on word/kanji detail pages speak readings via the Web Speech API, with explicit `ja-JP` voice selection, cancellable per-category sequences on kanji, and graceful degradation when no Japanese voice exists.

**As-built voice-quality finding:** Chromium/Electron's Web Speech API exposes only the OS's **classic SAPI5** Japanese voices (on Windows: Ayumi/Haruka/Ichiro/Sayaka), never the modern "Natural"/OneCore neural voices — a Chromium limitation. `localService` is uniformly `true`, so it's useless as a quality signal; selection now walks a name-preference list (`src/webview/speech.ts` `PREFERRED_VOICE_HINTS`) and defaults to a sensible SAPI5 voice. The genuine quality upgrade (bundled/downloaded audio) stays deferred — larger data effort, only worth it if synthesis quality proves unacceptable.

### 14. Preferences — native VS Code settings (decision changed 2026-07-18; groundwork SHIPPED)

**User decision:** no custom settings view — settings live in VS Code's native Settings UI via `contributes.configuration`, and the sidebar's ⚙ (search toolbar) opens the Jisho section (`workbench.action.openSettings @ext:saeris.vscode-jisho`; also palette: "Jisho: Open Settings"). Groundwork shipped with three settings proving both delivery paths:

- `vscode-jisho.hover.enabled` — host-side gate, read per hover.
- `vscode-jisho.appearance.textScale` — webview-side: settings snapshots push host → webview (`hostSettings` on `webviewReady` + on every `onDidChangeConfiguration`) and land as CSS variables (`--jisho-text-scale`), so components never read configuration directly and edits apply live without a reload.
- `vscode-jisho.strokeOrder.guideStyle` — exposes the `--guide-offset` dial (aligned/offset arrows) that had been sitting unwired since the stroke player work.

`e2e/settings.e2e.ts` launches with all three overridden in the seeded profile and verifies each path. Remaining candidates below — add each as a plain contributed setting; webview-affecting ones ride the same push:

- **TTS voice picker** — let the user choose from the Japanese voices the OS actually exposes (`getVoices()` filtered to `ja`), overriding the name-preference default from #13. Persist the choice (see persistence note below).
- **Furigana toggle** — the on/off switch for #15.
- **Text size** (added 2026-07-17) — a user-adjustable scale multiplier over the base font. The base got a fixed 1.08× lift (kanji need more pixels than latin to stay legible; the user found 13px kanji hard to read), but comfortable size is personal — expose the multiplier.
- **Editor hover toggle** (added 2026-07-18) — on/off for the Japanese dictionary hover (#33); the user expects some users to find it distracting. Ship as a plain VS Code setting (`vscode-jisho.hover.enabled`, checked in provideHover) so it works before the settings VIEW exists; surface in the view later.

**Persistence:** webview state doesn't survive reloads on its own. Persist prefs via a `setState`/`getState` message to the host, stored in the extension's `Memento` (`context.globalState`) — a small new message pair. Defer building the view until there are ≥2–3 real preferences to justify the chrome (voice + furigana is enough to start).

### 15. Furigana over kanji (feature — medium)

Optionally render furigana (kana reading ruby text) above kanji in headwords, and possibly in example sentences later. Uses HTML `<ruby>`/`<rt>`. The alignment problem — mapping which kana annotate which kanji — is non-trivial for mixed kanji/okurigana words (食べる → 食[た]べる, not 食べる[たべる]); JMdict-simplified publishes **furigana** data (kanji-to-kana spans) that solves exactly this, so add it as another build asset joined per word. Gated behind the #14 furigana toggle (some learners want the challenge of no readings).

**Add: conjugation tables** (user, 2026-07-17) — conjugated forms are where kanji pronunciation confusion actually bites (Shirabe doesn't do this). The table is the _easy_ furigana case: `conjugate()` is a pure function of (surface, POS), so running it twice — once on the headword, once on the kana reading — yields aligned pairs per cell (食べた/たべた), and the JMdict furigana spans give the stem split. Example sentences are the _most useful_ place (needs M5 tokenizer alignment or the furigana asset); do the table first when #14's toggle exists. Note: [@saeris/kuromoji](https://github.com/Saeris/kuromoji)/remark-ayaji also generate furigana via tokenization — cross-reference once M5's tokenizer lands.

### 16. Breakdown bar: filter the sentence in place instead of destructive re-search (fix — medium)

The M5 segment bar makes each content word a tappable chip, but tapping one **replaces** the search input with that lemma and re-searches — the original sentence is lost, and there's no way back to the previous fragment (it only survives word-detail back-navigation, not chip-to-chip). jisho.org's model is better: the breakdown is a **filter over the current sentence**, matching one segment at a time while the full sentence stays in the input, so you can move between fragments. Rework the chip action to select-a-segment (highlight the active fragment, drive the results filter) rather than overwrite the query. The navigation machine already reserves a selected-segment index in context for this. Deferred from M5 as polish.

## Shirabe reference UX (from M6 word-page screenshots)

Observed comparing our word detail against Shirabe Jisho's. Ordered small→large.

### 17. Recent-search history on the empty search view (feature — small)

When the search box is empty, Shirabe shows a list of the user's recent searches grouped by date ("Jul 10 / Jul 5 / Jun 30"), each tappable to re-run. Ours shows only a "Type to search" placeholder. Add a recent-search list: record each committed query (cap ~20, dedup, most-recent-first) and render it when the query is empty, each item re-running the search on tap. **Persistence** rides on the same host `Memento` (`context.globalState`) mechanism as BACKLOG #14 — a small `getState`/`setState` message pair, so pair it with or after #14. Independent of the rest; good small win.

### 18. Graphical pitch accent rendering (feature — medium) — ✅ shipped as the M6 #1 follow-up

Shirabe draws the pitch contour as an overline over the high-pitch moras with a downstep drop, strictly more legible than the numeric `[2]`. Shipped: `src/webview/pitch.ts` (mora segmentation + heiban/atamadaka/nakadaka/odaka contour) rendered by `PitchAccent.tsx` as per-mora CSS overline + downstep border over the kana, number in the tooltip. See M6 #1 as-built.

### 19. Verb/adjective conjugation table (feature — large) — DONE (2026-07-17)

> **Status:** shipped. `src/webview/conjugate.ts` generates the 13-row verb table (plus adjective tables) from the word's POS codes, rendered as a collapsed "Conjugations" disclosure on WordDetail; the engine's null gates the section. Covers v1, all v5 classes incl. the lexical irregulars (v5k-s/v5r-i/v5u-s/v5aru), vk in both spellings, する/vs-nouns, adj-i/ix/na, with the ら抜き potential in parens. The #8 round-trip test now exists: every searchable form the table shows must deinflect back to its dictionary form (it caught a real deinflect gap: させる→す).

Shirabe shows a full conjugation reference on the word page: Positive / Negative / Masu / Masu-negative groups, each covering present, past, -te, -eba/-tara conditionals, potential, passive, causative, imperative, volitional (screenshots show ~30 forms for 食べる). We have no conjugation display. This is **generation** logic — the inverse of `deinflect.ts` — so it pairs conceptually with BACKLOG #8's "forward conjugator" idea (a forward conjugator would both power this table _and_ give #8's round-trip deinflection tests). Scope: a conjugation engine keyed on the word's POS tags (v1/v5x/adj-i…), rendered as a labelled table on `WordDetail`, gated to conjugable POS. Large; a milestone candidate of its own or a big backlog item. Note colloquial variants Shirabe shows in parens (食べれる ら-nuki potential).

### 20. Two-tier examples + dedicated example pages (feature — medium, depends on M6 #2)

Shirabe layers examples three ways: (a) a per-sense "Examples Ⓐ/Ⓑ" list tied to each sense, (b) a word-level "Examples" section aggregating across senses, (c) a "More…" link to a full **Example sentences** page, and (d) tapping a sentence opens an **example-sentence breakdown** page — the sentence with furigana, a play button, and a "Words" list (each word tokenized out with reading + gloss, tappable). We ship only (a). Enhancements, each independent:

> **2026-07-17:** (a) is no longer a collapsed disclosure — per user feedback ("we shouldn't be aggressively collapsing"), the first two sentences now show inline with a "Show all (n)" in-place expander. That expander is a stopgap: the user's preferred end state is a **"More…" link to the dedicated page** — i.e. (c) — so when (c) lands, replace "Show all" with the page link. The user is also lukewarm on per-sense placement itself (it's explicit about sense association, which Shirabe obscures, but the layout cost is real) — revisit per-sense vs word-level (b) during the word-detail layout redesign.

- **(c) full examples page** — a new navigation-stack view listing all sentences for a word when it has more than the per-sense cap. Small once #2 exists.
- **(d) sentence breakdown page** — tap a sentence → tokenize it with the **M5 tokenizer** (the M6 #2 "tap-through deferred until M5's tokenizer exists" note — M5 now exists) → list its words with readings/glosses, each tappable to its word detail. This is the SegmentBar treatment applied to a full sentence. Medium.
- **furigana in sentences** — see #15; Shirabe's sentences carry ruby readings over kanji. Fold into #15 when furigana lands.
- TTS on sentences — a play button per sentence/page, reusing `speech.ts`. Trivial once the pages exist.

### 21. Stroke-SVG transform script + sibling-index() CSS (refinement of M7 #1)

M7 #1 vendored the customized AnimCJK SVGs from guide-to-japanese as-is (inline per-stroke `--d` delays). Two follow-ups: (a) a **build script that regenerates our SVG shape from the authoritative AnimCJK source** (inject the guides layer, our CSS), so we can re-sync from upstream instead of the author's uncommitted fork; (b) refactor the animation CSS to compute per-stroke delay from **`sibling-index()`/`sibling-count()`** (now available as CSS properties) instead of hardcoded `--d:1s…9s` — which needs wrapping the animated strokes in their own `<g>` so `sibling-index()` counts cleanly (a structural change the transform script should make). Together these make the SVGs reproducible and the CSS far simpler. Deferred from M7 #1 to keep the milestone moving.

**Related (M7 #2 / polish):** the handwriting recognizer's reference patterns (`src/webview/recognizer/patterns.data.ts`, a base64 binary blob) similarly want a **re-extract + re-encode tool** from the KanjiCanvas source, so adding/updating characters is reproducible rather than a one-off. Same "regenerate from authoritative upstream" theme — pair with (a). The binary format is documented in `src/webview/recognizer/README.md`.

### 22. Stroke-order quiz mode (feature — medium) — Duolingo/hanzi-writer style

Beyond passive stroke-order playback (M7 #1), add an interactive **quiz**: the user draws each stroke in order and gets per-stroke feedback (correct → advance; wrong → hint/flash), like [hanzi-writer](https://github.com/chanind/hanzi-writer)'s quiz function and Duolingo's kanji exercises. Reuses our stroke SVGs (the median paths give the expected stroke shape/order) + perfect-freehand for capture (already the M7 #2 drawing layer) — compare the user's stroke against the expected one positionally. Complements both the stroke-order animation and the handwriting recognizer. Its own focused effort; reference hanzi-writer's quiz UX and the median-path matching approach.

### 23. Pitch contour: overlay on the kana rather than a band above (refinement — small)

Our contour renders in a **dedicated band above** the reading; Shirabe **overlays** it on the kana, the line riding over the glyphs and sharing their vertical space. The band was a deliberate trade during the polish pass: an overlaid line at sidebar font sizes collided with the glyphs — verticals slicing neighbouring kana, the low line clipping descenders (た), which read as a box drawn around the accent mora rather than a pitch contour. Threading the line through a glyph's natural interior clearance needs font-metric awareness (ascender/x-height offsets per family and size) that the band approach avoids entirely, which is why it isn't a one-line CSS change. Deemed "good enough" by the author for now; revisit if the difference bothers in use. `PitchAccent.browser.spec.tsx` asserts the clear-of-glyphs invariant, so any overlay attempt must update that test's intent deliberately, not incidentally.

### 24. Recognizer patterns via `import ... with { type: "bytes" }` (refinement — small, BLOCKED on tooling)

`patterns.data.ts` is a 1.8MB TS module wrapping a base64 string that `patterns.ts` `atob()`s at runtime. The [import-bytes proposal](https://github.com/tc39/proposal-import-bytes) (TC39 **Stage 2.7**) would let us commit a raw `patterns.bin` and `import bytes from "./patterns.bin" with { type: "bytes" }` — deleting `patterns.data.ts`, the `decodeBase64` helper, and base64's +33% encoding overhead, and yielding a `Uint8Array` (backed by an immutable ArrayBuffer) straight to the existing `DataView` decoder.

**Blocked: Rolldown/Vite does not implement it.** Verified empirically (2026-07) — a probe importing a `.bin` with the attribute fails with `The requested module '…?import' does not provide an export named 'default'`; the attribute is silently ignored. Deno 2.4 and Bun have shipped comparable features, so bundler support is plausibly near.

Notes for whoever picks this up:

- **The bytes must arrive inside a JS module** — the webview CSP blocks fetching an asset, which is why `?url` + `fetch()` (the normal answer) is not available to us. This constraint is the whole reason for the base64 smuggling.
- `?raw` (a JS string) and `?inline` (a data URL, registered extensions only) both work today but are base64 under the hood — no real gain over the status quo.
- The **wire** win is smaller than +33% suggests: gzip recovers most of base64's overhead (current chunk 1.80MB → 1.25MB gz). The real wins are simpler code and less parse/heap churn.
- Pairs with **#21**'s patterns re-extract/re-encode tool — same encoder, so do them together. The binary format is specified in `src/webview/recognizer/README.md`.

### 25. Evaluated and declined: PGlite instead of Turso/SQLite (decision record)

Considered swapping `@tursodatabase/database` for [PGlite](https://pglite.dev) (WASM Postgres) to gain Postgres extensions. **Declined 2026-07.** Recorded so it isn't re-litigated from scratch.

**What PGlite would genuinely win:**

- **Real full-text search** — `tsvector`/GIN + `pg_trgm`/`fuzzystrmatch`. Our biggest standing compromise: Turso has no FTS5, so `db.ts` is restricted to indexed prefix range scans and forbids unanchored `LIKE '%…%'` (#1 exists largely because of this).
- **One universal `.vsix`** — a WASM engine needs no per-platform native binary, retiring `scripts/package-platforms.ts` (which swaps a 13MB `.node` per target).

**Why it loses anyway:**

- **Delivery model breaks.** Our DBs are 82MB / 130MB / 410MB and ship as portable SQLite files that are _downloaded and opened_. PGlite's storage is a PGDATA directory, so we'd either ship a `pg_dump` and `COPY` millions of rows in on first run (minutes of CPU) or tar a PGDATA dir (bulkier than SQLite, and coupled to the exact PG build). Losing "download the file, open it" is close to disqualifying on its own.
- **Single connection only** (PGlite's own docs; the multi-tab worker exists to elect one leader). We already open two — the main DB and the separate names DB (`names.ts`).
- **WASM is slower than the native binding** in the extension host, where we currently pay nothing.
- **Doesn't unblock M8.** Turso already ships a `-wasm` sibling build; the async query layer was written for that path from M1.
- **Cost is a full data-layer rewrite** — schema, `build-data.ts`, both query modules, delivery pipeline, and re-uploading every artifact.

**Revisit if:** Turso's native `fts_match` (Tantivy-backed, experimental) proves inadequate for #1; per-platform packaging becomes a real maintenance burden; or M8 hits a wall with `-wasm`.

### 26. BCCWJ frequency as an optional user-imported dictionary (feature — medium)

`nfXX` (see the ranking work) is a **newspaper** corpus, so it carries a newspaper's skew: it ranks 端 ("edge", constant in news prose) above 箸 ("chopsticks", rarely newsworthy), and buckets 講演/公演/公園 identically at `nf02`. [BCCWJ](https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html) (NINJAL's Balanced Corpus of Contemporary Written Japanese — 100M words across books, magazines, blogs, textbooks) is _balanced_ precisely to avoid that skew, and is the academic standard. It would fix the cases `nfXX` structurally cannot.

**Why it isn't bundled — a redistribution question, not a use question.** NINJAL states the frequency lists are "free for use for research or educational purposes" and that commercial use is "considered on an individual basis", but publishes **no redistribution terms at all**. This project is a free, non-commercial, open-source educational tool, so our _use_ sits comfortably inside their stated audience — but using data ourselves and **rebundling it into a shipped artifact re-served to thousands of users** are different permissions, and silence on the second is an unanswered question, not a yes. (Contrast JMdict: CC BY-SA 4.0 _explicitly_ grants redistribution, which is why bundling it is uncontroversial.) Note the MIT licence on [toasted-nutbread's converter](https://github.com/toasted-nutbread/yomichan-bccwj-frequency-dictionary) covers **the script, not NINJAL's data** — the same trap as AnimCJK/Arphic.

**Corroborating evidence:** [Yomitan bundles no frequency data at all](https://yomitan.wiki/dictionaries/) and requires users to import dictionaries themselves, while happily shipping JMdict. Neither [Kuuuube](https://github.com/Kuuuube/yomitan-dictionaries) nor [MarvNC](https://github.com/MarvNC/yomitan-dictionaries) publishes licensing for their frequency dictionaries. The ecosystem consistently routes around this.

**Approach — the Yomitan model:** let the user import BCCWJ themselves. They download it from NINJAL under terms that plainly cover them; we only read it. No redistribution question, better data. Fits the opt-in preferences menu already planned for the names DB (a `frequency_overrides` table keyed like `pitch_accents`, layered over `words.freq_rank` when present). Join is surface+reading, not JMdict id, so expect homograph ambiguity.

**Cheap way to settle it properly:** NINJAL invite contact at `kotonoha@ninjal.ac.jp`. A written "an open-source educational tool may bundle the frequency list" would make bundling a non-question. Worth asking before building the import path.

### 27. Tag classifiers + tag search (`#vulgar`, `#n5`) (feature — medium)

Two halves of one idea, both unlocked by the JMdict priority-tag extraction in the ranking work:

- **Classifiers on the word detail.** `ichi1`/`ichi2` (Ichimango goi bunruishuu), `news1`/`news2` (Mainichi Shimbun top 12k/24k), `spec1`/`spec2`, `gai1`/`gai2` (common loanwords) are real provenance signals worth surfacing as badges — "this word is in the newspaper top 12,000" is genuinely useful context. The build step for `nfXX` already parses them, so the data is free once that lands.
- **Tag search.** `#vulgar` returns words tagged `vulg`; `#n5` filters to JLPT N5 words _and_ kanji. We already store JMdict misc tags (`vulg`, `arch`, `obs`, `derog`, `col`…), POS tags, field tags, and JLPT levels — the data is present, only the query syntax and UI are missing. Needs a small query-syntax parser in the host (`#tag` prefix → filter, not a term match) plus UI affordances.

**Research first:** study [Jisho.org's tag vocabulary](https://jisho.org/docs) — it has a well-developed set (`#jlpt-n5`, `#common`, `#verb`, wildcards) and its search-operator docs are the reference implementation for this feature. Also relates to #16 (the parts-of-speech breakdown filter), which is the same "filter results by a classifier" affordance arrived at from a different direction — design them together.

### 28. Recursive component tree (data + view) — IN PROGRESS

The Jisho-style recursive breakdown from the 願 reference screenshot (願 → 原 + 頁 → 貝 → 目 + 八, indented, each node showing meaning/readings). We shipped only a **flat Parts list** (see #the kanji parts fix). Kradfile cannot produce the tree: it decomposes to a flat set of atoms and **omits intermediate nodes** — 願 gives ハ 厂 小 白 目 貝 頁 all at once, with no 原. So this needs a hierarchical decomposition source.

**Source chosen: [cjk-decomp](https://github.com/amake/cjk-decomp) (amake fork), under MIT** (it offers 6 licences; MIT is one, so no copyleft concern — unlike [cjkvi-ids](https://github.com/cjkvi/cjkvi-ids), whose `ids.txt` is CHISE-derived GPLv2). 84,269 records; format `char:type(part,part)` with recursive intermediate nodes. Verified it produces exactly the reference hierarchy for 願.

**Two data realities to handle (verified against the file):**

- It decomposes past the useful level into **stroke primitives and PUA glyphs** (㇒ ㇐ 𤽄…). Prune to nodes that **exist in `kanji_characters`** — which is also exactly the set we have meanings/readings to annotate, so the prune and the display gate are the same test. Bounds depth automatically.
- Some kanji (鬱) decompose _only_ through non-kanji nodes, so the pruned tree is empty/flat. **Fall back to the flat Parts list** when the tree has no real structure — decided, so no lone-node "trees".

**Placement:** its own pushed sub-page (a "Component tree ›" link on the kanji detail), matching the reference (a full-screen Components page) and keeping the detail lean. Each node tappable to its own kanji detail; stroke-shape leaves route like the flat Parts list (#the parts fix).

**Build:** precompute the pruned tree per kanji at build time into a new table (avoid recursing 84k records at query time), fetch pinned to a commit like the other sources.

### 29. Stroke-SVG transform: research findings (IN PROGRESS — supersedes #21a)

Everything below was verified against the real runtime or the real data. Recorded because most of it is non-obvious and was learned the hard way.

**The webview is Chromium 148 / Electron 42** (VS Code 1.128, probed via E2E). `sibling-index()`, `sibling-count()`, CSS `if()` and `@property` are **all supported**. "Not Baseline" on MDN is about the open web and does not apply to us — we ship to exactly one browser. This is what makes a CSS-first player possible at all; the pure-JS approach ([dmak](https://mbilbille.github.io/dmak/), inspected live) is a 2014 workaround for CSS that could not do this yet, and copying its architecture would be a regression.

**Our SVGs already carry `pathLength="3333"`** on every stroke, so every path is pre-normalised — the _other_ thing dmak needed JS for (measuring path length to compute `stroke-dasharray`) is also unnecessary.

**Why the transform is required, not optional:** in the AnimCJK source the animated strokes are siblings of `<style>`, `<defs>` and the filled glyph paths, so `sibling-index()` on stroke 1 returns **11**, not 1. They must be wrapped in their own `<g>` for the ordinal to be meaningful. And the embedded `<style>` autoplays on mount — there is no way to stop it from outside, which is the root cause of the broken player.

**AnimCJK's `dictionaryJa.txt` is a significant find** (7,184 entries, same APL licence we already ship). The `acjk` field encodes component structure with **per-component stroke counts**, and `.` marks the radical:

- `願⿰原10頁.9` → 原 = strokes 1–10, 頁 = strokes 11–19, **頁 is the radical**
- `語⿰言.7吾7` → 言 (radical) = strokes 1–7, 吾 = 8–14
- `近⿺斤4⻌.3` → 斤 = strokes 1–4, **⻌ (radical) = strokes 5–7**

That is exactly the "which stroke indices are the radical" mapping radical highlighting needs — a pure-CSS range check against `sibling-index()`. Note 近: the radical is **not** the leading strokes, so highlighting cannot assume it is. It also independently corroborates the cjk-decomp component tree (#28): 願 → 原 + 頁 matches.

**KanjiVG** ([kanjivg.tagaini.net](https://kanjivg.tagaini.net/)) has a better _annotation model_ — nested `<g kvg:element>` groups, `kvg:radical`, `kvg:type` stroke shapes (㇒㇐㇑…), and a `StrokeNumbers` group — and independently agrees (斤 1–4, ⻌ 5–7 radical). **But it is CC BY-SA 3.0**, real ShareAlike: merging its paths would make those files ShareAlike. Since `dictionaryJa.txt` gives the same stroke-range facts under APL, we don't need it. Keep it as a cross-check reference only; if ever used, note that the `kvg:` annotations are facts (uncopyrightable) while the paths are the licensed expression.

**Max stroke count is 29 (鬱)**; only 65 kanji exceed 20, none exceed 29. **Circled-number glyph coverage was probed in the real webview and is complete** — ①(U+2460) through ㉙(U+3259) all render at full width against a tofu control, including the 21+ block (U+3251–325F) that was the risk. So numbered start points (the author's Figma approach: the start dot _is_ the stroke number) are viable across the whole set.

**The guide arrows are NOT a trivial derivation.** `addGuidelines.ts` (guide-to-japanese) classifies each stroke by its start _and_ end heading (H/V/O × L/R × T/B) and uses a ~250-line decision table to pick an offset and taper so the guide runs alongside the stroke without overlapping it. A naive "short tick at the start point" discards all of that and looks wrong. Known drawback of the offset approach: guides can render outside the character's bounding box (observed when importing to Figma). **Duolingo** keeps direction paths aligned to the median instead. **Decision: emit both and interpolate** via a registered `@property --guide-offset` (0 = median-aligned/Duolingo, 1 = offset/current) — variable-font-style control, real CSS interpolation, no JS.

### 30. Radical position categories + click-a-stroke-to-look-up-its-radical (feature) — application 2 DONE (2026-07-17)

> **Status:** application 2 (click-a-region) shipped: the transform stamps `--part` + emits per-part hit rects (largest-first for the kamae overlap), the player highlights strokes+glyph via `--hl-part`, and clicking routes to the part's kanji detail or the radical picker. 3,571/3,821 SVGs carry part data. Application 1 (position-category filter in the radical picker) remains open.

From the Kanji Look & Learn references: radicals fall into **seven positional categories** — ① left (_hen_), ② top (_kanmuri_), ③ bottom (_ashi_), ④ enclosure (_kamae_), ⑤ upper-left (_tare_), ⑥ lower-left (_nyō_), ⑦ right (_tsukuri_) — and its "Kanji Parts" pages highlight the radical's region within the character.

**The categories are derivable from data we already ship.** `dictionaryJa.txt`'s `acjk` field encodes the IDC (split geometry) plus which side the `.` (radical) sits on:

| IDC          | Split      | Radical first            | Radical second            |
| ------------ | ---------- | ------------------------ | ------------------------- |
| `⿰`         | left-right | **hen** (体⿰亻.2本5)    | **tsukuri** (頭⿰豆7頁.9) |
| `⿱`         | top-bottom | **kanmuri**              | **ashi** (字⿱宀3子.3)    |
| `⿴⿵⿶⿷⿻` | surround   | **kamae** (国⿴囗.:2玉5) | kamae                     |
| `⿸⿹`       | upper-left | **tare** (広⿸广.3厶2)   | tare                      |
| `⿺`         | lower-left | **nyō** (道⿺首9⻌.3)    | nyō                       |

**Verified: 18/19 of the textbook's own examples classify correctly; 94% of 7,007 entries are classifiable.** [KanjiVG](https://kanjivg.tagaini.net/)'s `kvg:position` attribute uses the _same seven terms_ (`left/top/bottom/kamae/tare/nyo/right` — confirmed on 近=nyo, 体=left/right, 国=kamae, 広=tare) and agrees on every sample, so it's a good cross-check — but it's CC BY-SA 3.0, and we don't need it since the derivation above uses APL data we already ship.

**The 6% that don't classify are a real distinction, not a gap.** `見.⿱目5儿2` marks 見 _itself_ as the radical (見 IS Kangxi radical #147), so there's no sub-component to categorise — the textbook still files it under _ashi_ because it teaches _visual lookup_ ("find the 儿 at the bottom") while the data answers _classification_ ("this character is a radical"). For these, clicking any stroke should surface the character itself as its radical.

**Two applications:**

1. **Radical search filter** — let the picker filter/group by position category, matching how the textbook teaches lookup. Pairs with #27's tag-search idea (`#hen`).
2. **Click a component region to look up its radical.** **Box for hitting, strokes for showing** — the two are deliberately different geometry:
   - **Hit target = an invisible `<rect>`** sized to the component's stroke bounds, exactly like the reference's shaded regions. Strokes are thin; a bare path is a miserable click target (especially 亻), so the box is the _right_ affordance here, not an approximation the print edition settled for.
   - **Hover/focus styling = the component's STROKES**, never the box. `:hover`/`:focus-visible` on the rect restyles the strokes inside it. No shaded rectangle — that was the reference's constraint, not our goal.

   Because `acjk` gives each component's **stroke range** (願⿰原10頁.9 → 頁 = strokes 11–19), both halves fall out of the same data: compute the rect from those strokes' bounds, and target the same range with a CSS `sibling-index()` check for the styling.

   **Watch out:** `kamae` components enclose others (国 = 囗 around 玉), so their rects necessarily overlap the components inside. Order hit targets innermost-first so the inner component wins the click — verify against real enclosure characters (国 聞 医 凶) rather than assuming.

   Needs the #29 transform first (strokes wrapped in their own `<g>`, so `sibling-index()` is the stroke number and a CSS range check can target a component).

### 31. Ship stroke SVGs as files in the .vsix, not rows in the database — DONE (2026-07-17)

Implemented: `!assets/kanji-svgs/**` re-included in the package (licence files ship with it), `getStrokeSvg` reads from `extensionUri` in the provider (no database needed — the stroke page now works before the dictionary download finishes), and the `stroke_svgs` table + ingest pass are gone. The dev DB dropped 82 MB → 51 MB. Full architecture: [STROKE-ORDER.md](STROKE-ORDER.md). Original rationale kept below.

`stroke_svgs` held 3,821 SVGs (~27MB) inside the 82MB `jisho.db`. They were there because `assets/**` is `.vscodeignore`d — nothing in `assets/` shipped, and the DB is downloaded from a GitHub Release on first run, so the SVGs rode along inside it.

**Why change it.** The coupling is invisible and it bites: `vp run build:strokes` regenerates the FILES, but the extension serves the DB, so nothing changes until `vp run build:data` re-ingests them. Unit tests (`?raw` file imports) pass against the new data while the running extension renders the old — the two disagree silently, and the symptoms look like broken CSS rather than stale data. That cost a full debugging session. Beyond the trap: the SVGs are ~⅓ of the DB, and today a stroke-data fix forces users to re-download the entire dictionary.

**Approach.** Un-ignore `assets/kanji-svgs/**` so the SVGs ship in the .vsix, and have `getStrokeSvg` read from `context.extensionUri` instead of querying `stroke_svgs`. The message protocol and the webview don't change at all — only where the host gets the bytes.

- The **webview CSP blocks `fetch()`** (the reason `patterns.data.ts` is base64, #24), but this is a **host-side** read: the extension host is Node, so `readFile` is fine and CSP never enters into it.
- Adds ~27MB to the .vsix (currently small — the DB is downloaded). Weigh against removing 27MB from the download that every user must complete before the extension works at all, and against decoupling stroke fixes from dictionary releases.
- Drops `stroke_svgs` from the schema, and the SVG-ingest pass from `build-data.ts`.
- Consider `?raw` dynamic imports in the webview instead of a host round-trip; the bundler would inline 27MB, so probably not — but worth measuring.

### 32. Word-detail layout redesign toward Shirabe's definition formatting (design — medium)

User direction (2026-07-17): the sense/definition layout — and the labeling around it — should move toward Shirabe Jisho's formatting, which the user prefers over ours. Broader framing: _"a good amount of our design still reads as being done 'by an engineer'… I think we can do better than that."_ This is the umbrella for the next visual-iteration cycle on WordDetail specifically.

Ingredients already decided by adjacent feedback: explicit section splits with the uppercase-muted heading convention instead of collapsed disclosures (done for Conjugations/Examples); inline example previews with a More→page link (#20); suffix-emphasis coloring in the conjugation table (done). Reference screenshots (9 Shirabe vocab pages: 見せる, まっすぐ, 不味い, 古い, 病気, 一月, 冷たい) supplied 2026-07-17.

**Round 1 shipped (2026-07-17):** headline is now kana-first with each reading's applicable kanji writings in 【】 (renders appliesToKanji properly — 一月: ひとつき【一月, ひと月】 / いちげつ【一月】); pitch contour rides the headline kana (kana in fg, only the mark colored); POS/misc as a muted spelled-out line shown once per run of senses and again only when it changes; senses as Ⓐ Ⓑ Ⓒ circled letters with comma-joined glosses and inline muted annotations; xrefs inline as "(see also: 拙い)" / "(antonyms: 熱い)" links.

**Round 2 shipped (2026-07-17):** form markers on writings AND readings (探/稀/異/旧/送/当/訓 from the JMdict tags already in the DTO — 喰べる探, ビョーキ探) with a legend under the senses listing only the marks in use; an Info section (JLPT + WaniKani rows — a frequency row is deliberately deferred: words.freq_rank is nfXX-bucket data whose newspaper skew misleads, e.g. 見せる = bucket 35 vs Shirabe's "1–2k"; needs a better source, see #26 BCCWJ); a Kanji section with one tappable row per distinct character (literal, meanings, kun/on, chevron → kanji detail; characters without a Kanjidic entry get no row, never a dead end).

**Still to do from the references:** word-level Examples with furigana and the target word bolded, then per-sense "Examples Ⓐ" sections at the bottom (#20's restructure); bold target-word in sentences. Notes are out of scope forever.

### 33. Editor integrations: lookup, translate-replace, and furigana authoring tools (feature — large, user priority)

> See also #34 (contextual grammar notes) — born from this item's hover work.

User direction (2026-07-17): _"these are the kind of deeper integrations that make this extension useful for people authoring text in Japanese"_ — the user edits Japanese in markdown documents regularly. The ruby syntax target is **mirrordown's** (`@mirrordown/mdit-ruby` + `@mirrordown/remd-ruby` render it identically): `{漢字|かんじ}` → `<ruby>漢字<rt>かんじ</rt></ruby>`, with tests and context in the parent monorepo (github.com/mirrordown/mirrordown).

**Shipped (2026-07-17):** "Jisho: Look Up Selection" and "Jisho: Speak Selection" — palette + editor context menu (shown when a selection exists). Plumbing: a `HostPush` channel from host to webview with a `webviewReady` handshake, so a command issued before the sidebar ever opened queues and flushes once the bridge attaches; lookup reveals the view and drives the same `searchFor` path as tap-through (deinflection included — 食べました finds 食べる). Word-under-cursor (no selection) remains open below.

**Shipped (2026-07-18, spec 03):** the authoring set — **Copy as…** (a ⧉ menu per reading line on the word page: word / reading / romaji / furigana markdown / furigana HTML, with live previews), **Add & Remove Furigana** commands, and **word-under-cursor** for lookup/speak (empty selection resolves the word at the cursor through the hover's own `resolveWord`, so both agree on what "the word here" means; speak says the surface as written, search uses the lemma). Clipboard writes route through the host (`copyText` request → `vscode.env.clipboard`), replacing the webview's `navigator.clipboard`.

**Key finding: furigana did NOT need #15's JMdict span asset.** `src/shared/ruby.ts` aligns readings algorithmically — the surface splits into kanji/kana runs, kana runs become literal anchors in a regex over the reading, and the captures pair with the kanji runs — so `{食|た}べる` and `{買|か}い{物|もの}` come out right from (surface, reading) alone, with a whole-word `{食べる|のむ}` fallback when nothing matches. #15 remains the better source for DICTIONARY display (it is curated, not inferred), but authoring works today.

**User-requested (remaining):**

- **Translate & replace selection** — en→ja and ja→en: replace the selection with its best dictionary match (headword or gloss). Needs a confirm affordance (quick-pick of candidates) — silent best-match will guess wrong.
- ~~Paste with furigana~~ — subsumed: Copy as… exports the ruby form, Add Furigana annotates in place.

**Additional ideas (proposed, not yet user-approved):**

- ~~Markdown preview integration~~ — unnecessary: the mirrordown monorepo already ships that exact VS Code preview extension (user, 2026-07-17).
- **Hover provider** — PROTOTYPE SHIPPED (2026-07-18), user verdict: "that kind of codelens feature is killer"; UI polish welcome. Round 2 same day, from the user's real authoring docs: (a) **mirrordown-ruby aware** — {食|た}べました hovers as 食べました (the line is stripped to base text with an index map back; a cursor on the braces or the reading resolves the base; the highlight covers the whole {…|…} construct); (b) **auxiliary grouping** — たくなかった attaches to its verb so hovering any fragment of 食べたくなかった describes 食べる, not たい (the "suffixes detached from verbs" report); a verb's て/で attaches too, case particles stay separate. Still open: **settings toggle** (user: "some users might find it distracting" — add to #14), richer content (pitch, more senses), more languages/schemes, particle hovers (see #34). Test fixtures: the user's sample docs (scripts.md, lesson-06.md, chapter-5 excerpts — mixed EN/JA with and without ruby markup) should land in e2e/fixtures/ from the originals (the copies shared in-conversation were encoding-mangled).
- ~~Speak selection~~ — shipped with the first slice. Latency note (user, 2026-07-18): TTS onset is noticeably non-instant everywhere; our share (the up-to-1s getVoices wait on first use) is now pre-warmed at webview startup, the rest is Windows SAPI5 engine spin-up — out of our control via the Web Speech API (the neural OneCore voices aren't exposed to Chromium at all; see speech.ts header).
- **Strip furigana** — inverse of Add: unwrap ruby syntax back to plain text.
- **Kana ↔ romaji conversion** on selection.
- ~~Editor context-menu group~~ — shipped (2026-07-18): a "Jisho" submenu in the editor context menu holds both commands (user feedback: the flat items lacked context that they belonged to the extension / Japanese).

Sequencing: lookup-selection + context menu and speak-selection are small and independent (do first); copy/paste-as needs the copy-variant plumbing on the word page; add-furigana is the deep one (tokenizer + readings + #15 spans + degenerate cases like names). Licensing: mirrordown is MIT and the user's own project — integrate freely.

### 34. Contextual grammar notes: explain particles, auxiliaries, and conjugation fragments (feature — large, content-heavy)

User direction (2026-07-18), prompted by hovering grammatical fragments: dictionary entries explain WORDS, but a learner hovering は, を, 〜たくなかった, or 〜てしまう needs a GRAMMAR explanation — what the construct does, when it's used, its register. Quality bar: **Tae Kim's Guide to Japanese** and **Tofugu's grammar articles** are the user's reference standard for explaining nuance. Neither can be consumed as-is (Tae Kim is CC BY-NC-SA; Tofugu is plainly copyrighted) — **we derive our own original content**, using them only as models of what good explanations cover.

Shape: a curated grammar-notes dataset (our own writing, versioned in-repo — it's content, not scraped data), keyed by grammar point: particles (は/が/を/に/で/へ/と/から/まで/より…), auxiliaries and endings (ます/た/ない/たい/そう/らしい/〜ている/〜てしまう…), conjunctive forms. Each note: one-paragraph explanation + a canonical example. Surfaces, in order of value:

1. **Hover** — a particle/auxiliary segment under the cursor gets its grammar note (today it gets a thin JMdict entry at best). The auxiliary grouping (#33) already identifies the fragments.
2. **Conjugation table** — deepen the existing Term tooltips with the same notes (single source).
3. **Word page / grammar pages** — possibly a small grammar reference view later.

Start small: the ~15 N5 particles and the auxiliary chain the conjugation table already generates. This is a writing task as much as a coding one — budget accordingly.

### 35. Sort browseable lists by reading — gojūon order (fix — small)

Codepoint order over kanji is meaningless; Japanese "alphabetical" order is 五十音順 applied to the READING — and we already store readings for everything, so proper Japanese collation is nearly free. Apply to any browseable list (kanji detail's word list, name results, radical-picker matches): normalize katakana → hiragana, fold small kana and voiced marks (JIS X 4061 is the reference standard for the comparison rules), sort. Most Western dictionary apps get this wrong; getting it right is cheap differentiation. Note: search RESULTS keep relevance order — this is for lists a user scans like an index.

### 36. Name-reading fallback in the hover (JMnedict) — gated against false positives (feature — medium)

Hovering 田中 or 由紀子 in a document should resolve name readings — the "name readings are unknowable data" problem the whole Japanese ecosystem (furigana form fields, the 2025 Family Register reading requirement) is built around, and we already ship JMnedict. **User-flagged risk (2026-07-18): false positives** — JMnedict is enormous and nearly every common word is also somebody's name; an unconditional fallback would caption half the vocabulary with "female given name". Design gates from the start: (a) fire only when the WORD dictionary misses entirely; (b) boost confidence on adjacent name markers (さん/様/氏/くん/ちゃん); (c) render as a clearly-secondary line ("as a name: タナカ — surname"). Depends on the names DB being provisioned (it's an opt-in download — degrade to nothing, never prompt from a hover).

### 37. Misconversion & learner-grammar lint — "Jisho lint" diagnostics (feature — large)

The dominant Japanese text error is 誤変換 (IME homophone misconversion: 機会/機械, 保証/保障/補償), and the checking tradition is proofreading-shaped (Word's 校正, Just Right!, ATOK's hints, textlint's ja presets). A DiagnosticProvider on markdown/plaintext could flag, with learner-oriented explanations (#34's notes, not terse flags):

- homophone confusables: tokenizer + dictionary find same-reading/different-kanji candidates in context;
- ら抜き言葉 and friends: the conjugation engine GENERATES ら抜き forms (#19), so it can DETECT them — one table, both directions;
- register mixing (です・ます vs だ・である) — cheap to detect from the auxiliary chain the hover already extracts.

Prior art to study for rule shape (not content): textlint-rule-preset-ja-technical-writing. Fold into #38's server if that lands first.

### 38. Japanese-as-a-language-server: POS highlighting, lemma references, wakachigaki formatting (umbrella — large, remark-ayaji lineage)

User direction (2026-07-18). Tree-sitter itself doesn't fit — natural Japanese isn't context-free, and the morphological analyzer already plays Tree-sitter's role (Lindera's token stream IS the parse). But the programming-tools mapping is real, delivered through VS Code's own surfaces (and eventually an LSP wrapper so it all works in any editor — LSP as packaging, not feature):

- **POS semantic highlighting** — PROTOTYPE SHIPPED (2026-07-18): a DocumentSemanticTokensProvider on markdown/plaintext colors Japanese by part of speech at the MORPHEME level (auxiliaries distinct from their verb stem, so conjugation structure is visible), ruby-markup aware (a {食|た}べる group colors whole as its word). POS maps onto built-in token types so every theme colors it: verb→function, noun→variable, adjective→type, adverb→property, particle→keyword, auxiliary→macro. Off by default (`vscode-jisho.highlighting.enabled`) — recoloring documents is opinionated; the toggle applies live via onDidChangeSemanticTokens. Pure-kana runs stay uncolored (same tokenizer constraint as the hover — wrong boundaries would teach wrong boundaries). Awaiting the user's visual refinement pass: the type mapping is the first knob to turn; custom token types + semanticTokenScopes fallbacks are the upgrade path if the built-ins prove too arbitrary.

  **Round 2 direction — custom palettes + color-vision accessibility (user design input, 2026-07-18).** The user authored a POS palette for their Japanese slide decks (11 categories: pronoun, noun, adnominal, adjectival noun, adjective, particle, adverb, conjunction, interjection, verb, auxiliary verb; light + dark variants; designed toward CVD friendliness) and flagged that theme-hooking cannot serve color-vision-deficient users — different palettes per CVD type may be needed. Decisions:
  - **Vehicle: text editor decorations, not semantic tokens.** Semantic token colors come from themes; an extension can only ship static defaults (configurationDefaults on editor.semanticTokenColorCustomizations — rejected: no runtime switching, clobbers user customizations at the object level). DecorationRenderOptions carry per-type color with NATIVE light:/dark: variants (the user's two-variant palette maps 1:1) plus fontWeight/textDecoration.
  - **Non-color channels are the stronger CVD answer**: per-POS bold/underline survives every deficiency including monochromacy; palette variants per CVD type are then plain data on top. Ship both.
  - **Setting**: `vscode-jisho.highlighting.palette`: "theme" (current semantic-token mode) | "jisho" (the user's palette) | CVD variants as they're authored. Palettes are data: category → { light, dark, fontWeight?, textDecoration? }.
  - **Taxonomy extension prerequisite**: the palette's 11 categories vs our 7-value PartOfSpeech. IPADIC subcategories supply the split (名詞-代名詞 → pronoun, 連体詞 → adnominal, 名詞-形容動詞語幹 → adjectival noun, 接続詞 → conjunction, 感動詞 → interjection); ripple: SegmentDto union + SegmentBar chip colors (which should adopt the same palette — one palette, two surfaces).
  - **BLOCKED on the palette's actual values** — the user has them (Figma/slides); eyeballing hexes from a screenshot would drift a deliberately CVD-tuned palette. Requested 2026-07-18.

  **Monaspace evaluation (user request, 2026-07-18; sources: github.com/githubnext/monaspace + lettermatic.com/custom/monaspace-case-study).** Monaspace = five metric-compatible monospace families (Neon grotesque, Argon humanist, Xenon slab, Radon handwritten, Krypton mechanical/OCR; OFL) whose explicit thesis is TYPEFACE-AS-SEMANTIC-CHANNEL ("Argon for human comments, Krypton for machine output"), with texture healing (`calt`) fixing Latin monospace density. Findings:
  - **Direct use for Japanese POS: not viable.** No CJK glyphs (>6,000 glyphs, Latin/Cyrillic/Greek/Vietnamese focus) — Japanese text falls back to a system font, so the five voices can't render the text we'd be differentiating. VS Code also officially cannot mix families in the main editor ("not yet possible to mix multiple fonts"; only `editor.inlineSuggest.fontFamily` is separable), and DecorationRenderOptions has no fontFamily (the `textDecoration: "none; font-family: …"` CSS-smuggling hack exists — unsupported, flag experimental if ever used).
  - **The transferable thesis lands BETTER in Japanese:** Monaspace's hard engineering problem — five families on one shared grid — is free in CJK, where every glyph already occupies a uniform em square. The "superfamily" also already exists as the classical Japanese type classification: ゴシック体 (≈Neon), 明朝体 (≈Xenon), 丸ゴシック (≈Argon's warmth), 教科書体 (≈Radon — and pedagogically loaded: kyōkasho-tai shows CORRECT handwritten letterforms where Gothic/Mincho print forms differ, e.g. 令/心, so using it for content words literally teaches handwriting). Texture healing is moot for CJK (no narrow/wide variance to heal).
  - **Application: "typeface" becomes the third channel in the palette engine** (after color and weight/underline), opt-in, never default (user's call): palette entries gain optional font-family stacks. Webview first (we own the CSS; SegmentBar chips + conjugation table are natural surfaces) with system-JP stacks and graceful fallback (Windows: UD デジタル教科書体, Yu Gothic/Mincho, BIZ UD; macOS: Hiragino Kaku/Maru/Mincho, Klee); editor decorations only via the experimental hack, if ever. A "textbook" palette variant — content words in 教科書体, grammar in Gothic — would be legible under monochromacy AND instructive.
  - Monaspace itself remains relevant only for LATIN content (glosses/romaji/UI could adopt it from the webview, OFL permits bundling — weigh the woff2 size) and as a docs tip for users' own editors (`editor.fontLigatures: "'calt'"`).

- **分かち書き formatter** — SHIPPED (2026-07-18) as commands rather than a Format Document provider (registering as THE markdown formatter would fight the user's existing formatter): "Jisho: Add Word Spacing (分かち書き)" / "Remove Word Spacing", palette + editor submenu, operating on the selection (expanded to whole lines) or the whole document. Group-level boundaries (conjugations stay whole, particles separate), ruby-atomic ({食|た}べる spaces before its brace), pure-kana runs untouched (tokenizer constraint), removal keeps EN↔JA spaces and handles ideographic spaces; add⇄remove round-trips losslessly (tested against the real tokenizer).
- **Lemma-aware occurrences** — find-references/rename analogs: highlight all occurrences of a word regardless of conjugation (食べる matches 食べたくなかった via the lemma index the hover already computes). Self-editing aid: overuse detection.
- **Readability profiling** — code-metrics analog: per-document JLPT-level breakdown ("82% N5, 3 words above N3") via the word-level JLPT data we ship; ideal for authoring course material at a target level (the user teaches with these docs).

Sequencing within: semantic highlighting first (pure win, reuses everything), then the formatter (small, high personal value to the user), references, profiling; LSP extraction last, once the services stabilize. #37's diagnostics ride the same infrastructure.

### 39. Automated data builds, asset delivery, and update lifecycle (infrastructure — large, RELEASE BLOCKER)

Full spec: [specs/05-asset-delivery.md](specs/05-asset-delivery.md). The dictionary download client is complete (sha256-verified, atomic, version sidecars) but the **producer does not exist** — `dictionary-latest` has never been published, so no installed user could obtain a dictionary. This is the last major piece before the first release.

Scope: a `dictionary.yml` workflow that rebuilds on schema change (not schedule alone — a release must never ship before its compatible artifact exists), **schema-version gating** so an extension only accepts a DB it can actually read (spec 04's new `radicals.position` column is exactly the mismatch this prevents), schema-namespaced artifacts so old clients keep working, a Wallaby-style automatic + manual update check, and `globalStorage` cleanup so superseded ~400 MB databases don't accumulate.

Decided along the way: **stroke SVGs stay bundled in the .vsix** rather than being archived like the DB — the measured .vsix is only 30.6 MB, and a second delivery path would reintroduce the two-source-of-truth staleness bug #31 removed. Measured non-optimizations recorded in the spec (the 99%-duplicated `term_lower` is only ~5 MB of text that gzip already collapses; no `VACUUM` win — freelist is 0).

### 40. Web extension support (feasibility settled — viable, post-v1)

Full analysis: [specs/06-web-extension.md](specs/06-web-extension.md). A web extension runs in a Web Worker with no Node APIs, so the question was whether our asset delivery survives. Verified: **both hard dependencies have browser builds** — `@tursodatabase/database-wasm` v0.7.0 (MIT, OPFS-persisted, same version as our native build) and `lindera-wasm-ipadic` v2.1.0 — and the **stroke SVGs need no change at all**, since `vscode.workspace.fs` + `extensionUri` are VS Code APIs, not Node ones (#31's decision holds in both environments). Download/gunzip/sha256 map onto `fetch` + `DecompressionStream` + `crypto.subtle`.

The real constraint is size, not capability: ~400 MB in OPFS is untenable (per-origin quotas, eviction, and a hostile first-run on vscode.dev). So the web build ships a **different data tier** — the existing 51 MB common subset by default, full DB as an explicit opt-in, names DB not offered. Known upstream risk, non-blocking: turso documents an OPFS **write**-path hang (mid-transaction cache spilling); our browser workload is read-only, and seeding should write the file to OPFS directly rather than INSERTing rows.

Work is a platform seam (`"browser"` entry point + two thin backends), not a rewrite — the query layer, hover, spacing, furigana and the entire webview are already platform-free. Sequenced after the desktop release so we are not maintaining two unproven delivery paths at once.

### 41. Benchmarking and performance strategy (infrastructure — pilot done)

Full spec: [specs/07-performance.md](specs/07-performance.md). A working deoptkit benchmark exists (`bench/recognize.bench.mjs`, `vp run bench:build`) and the profile→findings→verify loop is proven against the real recognizer.

The pilot's most useful result was a negative one: `recognize()` costs 17ms warm against 2,213 patterns, and **67% of that is `endPointDistance` + `initialDistance`, neither of which produced a deoptkit finding**. The 12 findings (4 eager deopts, 8 polymorphic ICs — no megamorphic sites, no deopt loops) sit in `coarseClassification`/`fineClassification`, worth ~2% of ticks. So shape-fixing here would be a rounding error; the real win is algorithmic (shrink the candidate set the coarse filter walks). The tool earned its keep by telling us what NOT to spend a day on.

Tool boundaries matter and are recorded: deoptkit sees only JS we wrote — the database (native addon) and tokenizer (12MB WASM) are opaque calls, and the webview is another process. Database performance is tracked separately in the spec (EXPLAIN QUERY PLAN, the `searchNames` N+1, full-DB rather than dev-subset timings) and depends on spec 05 producing a full DB to measure against.

## Suggested sequencing

1. **#1 (relevance ranking)** — highest leverage, self-contained, improves every query.
2. **#6 (persist search state)** — small UX win, independent.
3. **#2 (deinflection)** — bounded rule-based transform; big correctness win for learners.
4. **#5 (Kanjidic + kanji results)** — adds the next dataset; unlocks kanji detail later.
5. **#7 (tap-through)** — interaction polish once results are good.
6. **#4 (tokenizer)** then **#3 (multi-word)** — the largest work; do last, after evaluating Kuromoji.
