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

## Suggested sequencing

1. **#1 (relevance ranking)** — highest leverage, self-contained, improves every query.
2. **#6 (persist search state)** — small UX win, independent.
3. **#2 (deinflection)** — bounded rule-based transform; big correctness win for learners.
4. **#5 (Kanjidic + kanji results)** — adds the next dataset; unlocks kanji detail later.
5. **#7 (tap-through)** — interaction polish once results are good.
6. **#4 (tokenizer)** then **#3 (multi-word)** — the largest work; do last, after evaluating Kuromoji.
