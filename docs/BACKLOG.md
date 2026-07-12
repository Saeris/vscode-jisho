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

## Post-M4 UX feedback (from testing the kanji features)

### 9. Escape hatch back to search root (fix — small)

Link-driven navigation (word → kanji → component kanji → word → …) builds a deep stack that's tedious to Back out of. The navigation machine already has a `home`/`reset` action (collapses the stack to `search`) — it just needs a UI affordance. Add a persistent "home"/breadcrumb control in detail-view headers (a 🏠 or the app title as a button) dispatching `home`. Consider showing it only when `canGoBack` and stack depth > 1. Trivial; independent.

### 10. Jargon tooltips (feature — small)

Dictionary terminology is opaque to newcomers (the user hadn't seen "nanori"). Add hover tooltips to non-obvious labels — start with **on / kun / nanori** in `KanjiDetail`, apply sparingly elsewhere as more are found. Implementation: a small `<Term>` component (React Aria `Tooltip` + `TooltipTrigger`, which we already have via react-aria-components) wrapping the label with a definition string; theme-aware. A tiny glossary map keeps definitions in one place.

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

### 14. Preferences / settings view (feature — medium)

A settings view accumulating user preferences, reachable from the search bar (⚙ affordance) as another navigation-stack view. First candidates:

- **TTS voice picker** — let the user choose from the Japanese voices the OS actually exposes (`getVoices()` filtered to `ja`), overriding the name-preference default from #13. Persist the choice (see persistence note below).
- **Furigana toggle** — the on/off switch for #15.

**Persistence:** webview state doesn't survive reloads on its own. Persist prefs via a `setState`/`getState` message to the host, stored in the extension's `Memento` (`context.globalState`) — a small new message pair. Defer building the view until there are ≥2–3 real preferences to justify the chrome (voice + furigana is enough to start).

### 15. Furigana over kanji (feature — medium)

Optionally render furigana (kana reading ruby text) above kanji in headwords, and possibly in example sentences later. Uses HTML `<ruby>`/`<rt>`. The alignment problem — mapping which kana annotate which kanji — is non-trivial for mixed kanji/okurigana words (食べる → 食[た]べる, not 食べる[たべる]); JMdict-simplified publishes **furigana** data (kanji-to-kana spans) that solves exactly this, so add it as another build asset joined per word. Gated behind the #14 furigana toggle (some learners want the challenge of no readings). Note: [@saeris/kuromoji](https://github.com/Saeris/kuromoji)/remark-ayaji also generate furigana via tokenization — cross-reference once M5's tokenizer lands.

### 16. Breakdown bar: filter the sentence in place instead of destructive re-search (fix — medium)

The M5 segment bar makes each content word a tappable chip, but tapping one **replaces** the search input with that lemma and re-searches — the original sentence is lost, and there's no way back to the previous fragment (it only survives word-detail back-navigation, not chip-to-chip). jisho.org's model is better: the breakdown is a **filter over the current sentence**, matching one segment at a time while the full sentence stays in the input, so you can move between fragments. Rework the chip action to select-a-segment (highlight the active fragment, drive the results filter) rather than overwrite the query. The navigation machine already reserves a selected-segment index in context for this. Deferred from M5 as polish.

## Shirabe reference UX (from M6 word-page screenshots)

Observed comparing our word detail against Shirabe Jisho's. Ordered small→large.

### 17. Recent-search history on the empty search view (feature — small)

When the search box is empty, Shirabe shows a list of the user's recent searches grouped by date ("Jul 10 / Jul 5 / Jun 30"), each tappable to re-run. Ours shows only a "Type to search" placeholder. Add a recent-search list: record each committed query (cap ~20, dedup, most-recent-first) and render it when the query is empty, each item re-running the search on tap. **Persistence** rides on the same host `Memento` (`context.globalState`) mechanism as BACKLOG #14 — a small `getState`/`setState` message pair, so pair it with or after #14. Independent of the rest; good small win.

### 18. Graphical pitch accent rendering (feature — medium) — ✅ shipped as the M6 #1 follow-up

Shirabe draws the pitch contour as an overline over the high-pitch moras with a downstep drop, strictly more legible than the numeric `[2]`. Shipped: `src/webview/pitch.ts` (mora segmentation + heiban/atamadaka/nakadaka/odaka contour) rendered by `PitchAccent.tsx` as per-mora CSS overline + downstep border over the kana, number in the tooltip. See M6 #1 as-built.

### 19. Verb/adjective conjugation table (feature — large)

Shirabe shows a full conjugation reference on the word page: Positive / Negative / Masu / Masu-negative groups, each covering present, past, -te, -eba/-tara conditionals, potential, passive, causative, imperative, volitional (screenshots show ~30 forms for 食べる). We have no conjugation display. This is **generation** logic — the inverse of `deinflect.ts` — so it pairs conceptually with BACKLOG #8's "forward conjugator" idea (a forward conjugator would both power this table _and_ give #8's round-trip deinflection tests). Scope: a conjugation engine keyed on the word's POS tags (v1/v5x/adj-i…), rendered as a labelled table on `WordDetail`, gated to conjugable POS. Large; a milestone candidate of its own or a big backlog item. Note colloquial variants Shirabe shows in parens (食べれる ら-nuki potential).

### 20. Two-tier examples + dedicated example pages (feature — medium, depends on M6 #2)

Shirabe layers examples three ways: (a) a per-sense "Examples Ⓐ/Ⓑ" list tied to each sense, (b) a word-level "Examples" section aggregating across senses, (c) a "More…" link to a full **Example sentences** page, and (d) tapping a sentence opens an **example-sentence breakdown** page — the sentence with furigana, a play button, and a "Words" list (each word tokenized out with reading + gloss, tappable). We ship only (a) as a collapsed disclosure. Enhancements, each independent:

- **(c) full examples page** — a new navigation-stack view listing all sentences for a word when it has more than the per-sense cap. Small once #2 exists.
- **(d) sentence breakdown page** — tap a sentence → tokenize it with the **M5 tokenizer** (the M6 #2 "tap-through deferred until M5's tokenizer exists" note — M5 now exists) → list its words with readings/glosses, each tappable to its word detail. This is the SegmentBar treatment applied to a full sentence. Medium.
- **furigana in sentences** — see #15; Shirabe's sentences carry ruby readings over kanji. Fold into #15 when furigana lands.
- TTS on sentences — a play button per sentence/page, reusing `speech.ts`. Trivial once the pages exist.

### 21. Stroke-SVG transform script + sibling-index() CSS (refinement of M7 #1)

M7 #1 vendored the customized AnimCJK SVGs from guide-to-japanese as-is (inline per-stroke `--d` delays). Two follow-ups: (a) a **build script that regenerates our SVG shape from the authoritative AnimCJK source** (inject the guides layer, our CSS), so we can re-sync from upstream instead of the author's uncommitted fork; (b) refactor the animation CSS to compute per-stroke delay from **`sibling-index()`/`sibling-count()`** (now available as CSS properties) instead of hardcoded `--d:1s…9s` — which needs wrapping the animated strokes in their own `<g>` so `sibling-index()` counts cleanly (a structural change the transform script should make). Together these make the SVGs reproducible and the CSS far simpler. Deferred from M7 #1 to keep the milestone moving.

**Related (M7 #2 / polish):** the handwriting recognizer's reference patterns (`src/webview/recognizer/patterns.data.ts`, a base64 binary blob) similarly want a **re-extract + re-encode tool** from the KanjiCanvas source, so adding/updating characters is reproducible rather than a one-off. Same "regenerate from authoritative upstream" theme — pair with (a). The binary format is documented in `src/webview/recognizer/README.md`.

### 22. Stroke-order quiz mode (feature — medium) — Duolingo/hanzi-writer style

Beyond passive stroke-order playback (M7 #1), add an interactive **quiz**: the user draws each stroke in order and gets per-stroke feedback (correct → advance; wrong → hint/flash), like [hanzi-writer](https://github.com/chanind/hanzi-writer)'s quiz function and Duolingo's kanji exercises. Reuses our stroke SVGs (the median paths give the expected stroke shape/order) + perfect-freehand for capture (already the M7 #2 drawing layer) — compare the user's stroke against the expected one positionally. Complements both the stroke-order animation and the handwriting recognizer. Its own focused effort; reference hanzi-writer's quiz UX and the median-path matching approach.

## Suggested sequencing

1. **#1 (relevance ranking)** — highest leverage, self-contained, improves every query.
2. **#6 (persist search state)** — small UX win, independent.
3. **#2 (deinflection)** — bounded rule-based transform; big correctness win for learners.
4. **#5 (Kanjidic + kanji results)** — adds the next dataset; unlocks kanji detail later.
5. **#7 (tap-through)** — interaction polish once results are good.
6. **#4 (tokenizer)** then **#3 (multi-word)** — the largest work; do last, after evaluating Kuromoji.
