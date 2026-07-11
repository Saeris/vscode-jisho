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

### 11. Duolingo-style autocomplete suggestions (feature — large) — DEFERRED; desktop feasibility ruled out (M5 research)

A horizontal suggestion strip above/below the search field showing kana/romaji candidates with romaji ruby text, matching the Duolingo IME UX (reference screenshot in the conversation): ↑ from the search box moves into the strip (exact input as item 1, focus starts on the best-match item 2 so ← → the exact input and → advances), ↓/Esc return to the input, underlining the current word being suggested-on (word boundaries), reserving space to avoid layout shift.

**Feasibility verdict (researched M5, 2026-07): not viable on desktop as designed.** The reference screenshot's candidate strip is a **custom in-app IME overriding the OS default** — Duolingo achieves this because it's a **native iOS app** using UIKit custom-input-view APIs. A VSCode webview is **web content**, and the web platform gives no supported way to override/suppress the OS IME candidate window: IME composition `beforeinput` events are **non-cancelable** per the [Input Events spec](https://w3c.github.io/input-events/) (`insertCompositionText` is not cancelable), and `chrome.input.ime` (the only "custom IME" API) is **ChromeOS-extension-only**, unavailable to web content. So an in-app strip would fight, not replace, the OS IME, which already does romaji→kana→kanji conversion before text reaches our field.

Additionally the fallback value is thin: for romaji-typed-without-an-IME, our existing romaji search + tokenizer deinflection already resolve the word. **Revisit only** if a mobile-web target ever exists (different IME story), and even then weigh against the OS IME. Keeping deferred with this settled rationale.

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

## Suggested sequencing

1. **#1 (relevance ranking)** — highest leverage, self-contained, improves every query.
2. **#6 (persist search state)** — small UX win, independent.
3. **#2 (deinflection)** — bounded rule-based transform; big correctness win for learners.
4. **#5 (Kanjidic + kanji results)** — adds the next dataset; unlocks kanji detail later.
5. **#7 (tap-through)** — interaction polish once results are good.
6. **#4 (tokenizer)** then **#3 (multi-word)** — the largest work; do last, after evaluating Kuromoji.
