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

### 8. Harden the deinflection rule table (refinement of #2 as shipped in M2)

The shipped `src/host/deinflect.ts` is a hand-maintained suffix-rewrite array — nothing structurally prevents a missing row (the する/くる irregulars were in fact initially missed). Two ideas modeled on [typed-japanese](https://github.com/typedgrammar/typed-japanese), which encodes Japanese grammar rules in TypeScript's type system:

- **Type-level exhaustiveness:** restructure the rule table as mapped types over closed sets (godan endings う|く|ぐ|す|つ|ぬ|ぶ|む|る × form families), so the compiler rejects an incomplete matrix instead of a test hopefully catching it.
- **Round-trip property tests:** implement (or borrow) a small _forward_ conjugator for known verbs across every (class, form) pair and assert `deinflect()` recovers each dictionary form — replacing hand-picked examples with systematic coverage.

Caveat: typed-japanese self-reports LLM-generated rules with possible inaccuracies — use it as a structural model; Yomitan's tables stay the correctness reference. Superseded eventually by M5's tokenizer, so weigh effort accordingly.

## Post-M4 UX feedback (from testing the kanji features)

### 9. Escape hatch back to search root (fix — small)

Link-driven navigation (word → kanji → component kanji → word → …) builds a deep stack that's tedious to Back out of. The navigation machine already has a `home`/`reset` action (collapses the stack to `search`) — it just needs a UI affordance. Add a persistent "home"/breadcrumb control in detail-view headers (a 🏠 or the app title as a button) dispatching `home`. Consider showing it only when `canGoBack` and stack depth > 1. Trivial; independent.

### 10. Jargon tooltips (feature — small)

Dictionary terminology is opaque to newcomers (the user hadn't seen "nanori"). Add hover tooltips to non-obvious labels — start with **on / kun / nanori** in `KanjiDetail`, apply sparingly elsewhere as more are found. Implementation: a small `<Term>` component (React Aria `Tooltip` + `TooltipTrigger`, which we already have via react-aria-components) wrapping the label with a definition string; theme-aware. A tiny glossary map keeps definitions in one place.

### 11. Duolingo-style autocomplete suggestions (feature — large, design-heavy)

A horizontal suggestion strip above/below the search field showing kana/romaji candidates with romaji ruby text, matching the Duolingo IME UX (see the reference screenshot in the conversation). Substantial interaction design:

- **When it appears:** detect romaji vs kana vs English input; show suggestions only for romaji/kana, suppressing once the input reads as English (apparent by ~3rd–4th char). Underline the current "word" being suggested on (break on word boundaries); the suggestion replaces just that segment.
- **Keyboard model:** ↑ from the search box moves focus into the strip; the user's exact input is item 1, suggestions follow. Entering the strip focuses **item 2** (best match), so ← goes to the exact input and → advances through suggestions. ↓ returns focus to the input unchanged. Esc returns to the input.
- **Risks/unknowns:** interaction with the **host OS IME** (the on-screen candidate bar in the screenshot is the OS IME, not the app — in a desktop VSCode webview we're typing into a text field the OS IME already augments; clarify what value we add over it, and whether we suppress/coexist). Reserve vertical space to avoid layout shift. This likely wants its own mini plan doc before building. Note: overlaps conceptually with M5's tokenizer (word-boundary detection) — sequence after or alongside M5.

### 12. Arrow-key navigation between search box and results (fix — medium)

Complement #11's ↑-into-suggestions with **↓ from the search box moving focus into the results list** (today reaching results needs several Tabs past the 部/ⓘ buttons). In the results list, ↑/↓ move through items; ↑ at the top (or Esc) returns focus to the input. Pairs naturally with #11 as one keyboard-navigation model. React Aria's ListBox already handles intra-list arrows; the piece to add is the input↔list focus hand-off.

### 13. Pronunciation text-to-speech (feature — medium) — scheduled for the M4.5 quick-wins pass

A play button on word and kanji detail pages that speaks the reading aloud, like Shirabe, via the webview's **Web Speech API** (`speechSynthesis`). Requirements:

- **Explicit Japanese voice.** Must select a `ja-JP` voice — a naive `speak()` can default to a Chinese reading for kanji. Set `utterance.lang = "ja-JP"` and pick a matching voice from `getVoices()`.
- **Prefer natural voices.** Where the OS offers higher-quality/"natural"/"neural" voices, prefer them over the robotic default (heuristic match on voice name; `localService === false` often signals the better cloud/neural voices).
- **Graceful degradation.** If no `ja-JP` voice exists in the webview, hide the button (feature-detect; `getVoices()` may populate async via `voiceschanged`).
- **Word page:** one play button per reading.
- **Kanji page:** a play button _per reading category_ (on / kun / nanori) that reads through that list with pauses between entries, and is **cancellable** (`speechSynthesis.cancel()`), with visible playing/stop state.

No host/data changes; pure webview. Fallback to bundled/downloaded audio only if synthesis quality/availability disappoints (larger data effort — deferred).

## Suggested sequencing

1. **#1 (relevance ranking)** — highest leverage, self-contained, improves every query.
2. **#6 (persist search state)** — small UX win, independent.
3. **#2 (deinflection)** — bounded rule-based transform; big correctness win for learners.
4. **#5 (Kanjidic + kanji results)** — adds the next dataset; unlocks kanji detail later.
5. **#7 (tap-through)** — interaction polish once results are good.
6. **#4 (tokenizer)** then **#3 (multi-word)** — the largest work; do last, after evaluating Kuromoji.
