# Spec 16 — Tabbed navigation, and Kanji + Kana browse

**Backlog:** extends #54 (vocabulary lists). **Status:** SPECIFIED, not yet implemented. Reference: Shirabe Jisho's Kanji-lists and Kana screens.

## Objective

Vocabulary browsing (#54) shipped as a view you navigate _to_, from a button on the empty search screen. Shirabe treats browsing as a peer of search — top-level sections you switch between, each remembering where you were. Adopt that, and add the two sections we lack: **Kanji** (by grade, JLPT, frequency, radicals) and **Kana** (the gojūon grid).

Four tabs along the bottom of the panel: **Search · Vocab · Kanji · Kana**.

## The navigation model (decided with the user)

The tabs are **the root of the stack, not a peer of the detail views**. Their shared purpose is to get you to a Word, Kanji or Examples page; once you are on one of those, the tabs are irrelevant chrome.

- `stack[0]` is always the navigation root. The active tab is a field on it.
- The tab bar renders **only at depth 1**. Drilling into a word or kanji hides it.
- **Home** returns to the navigation root, on whichever tab you left.
- Back and the X1/X2 mouse buttons keep their current semantics — one stack, unchanged.

This was chosen over **per-tab stacks** (four independent histories, mobile-style). Per-tab stacks would have meant Back never crossing tabs, at the cost of restructuring `NavContext` into four stacks plus reworking `canGoBack`/`canGoHome`/`persist`. The root-plus-tab model gets the same user-visible behaviour — you return to where you left off — because of the state decision below.

It is also barely a change to the machine: `reset` already hardcodes `[{ name: "search" }]` as the floor and `hydrateContext` already enforces `stack[0].name === "search"`. The root is being **renamed**, not introduced, and `search` becomes one tab within it rather than the root itself.

## Per-tab state lives in the DOM, via `<Activity>`

Each tab has state beyond "which tab is open":

| tab    | state to preserve                              |
| ------ | ---------------------------------------------- |
| Search | query, results, scroll (already handled)       |
| Vocab  | breadcrumb depth (group → category), scroll    |
| Kanji  | breadcrumb depth (group → level/grade), scroll |
| Kana   | hiragana/katakana toggle                       |

None of it goes in the machine. All four tabs stay mounted inside [`<Activity>`](https://react.dev/reference/react/Activity), `visible` for the active one and `hidden` for the rest, so an inactive tab is **off-screen rather than unmounted** and its scroll position, list virtualisation and query subscriptions survive untouched.

This is the pattern `SearchResults` already uses — its comment states the argument: "its scroll position, list state, and query subscriptions all survive Back natively." Extending it to four tabs means the machine tracks only `tab`, and breadcrumb depth is ordinary component state inside each tab.

**Amended in build:** the Vocab tab's drill level moved onto the machine as `browseGroup`. Local state could not serve the word list's breadcrumb — a PUSHED view whose root crumb has to reach the top of the tab underneath it, and a sibling component cannot reach a `useState` setter. The symptom was both upward crumbs doing the same thing: from `Vocab › Subject › Computing`, tapping "Vocab" landed on `Vocab › Subject`. Scroll position and list virtualisation stay in component state, which is what `<Activity>` is actually for; this one field is shared because something outside the root sets it. The Kanji tab keeps local state — its list never leaves the tab, so nothing outside needs to reset it. `browseGroup` is deliberately absent from `hydrateContext`, which preserves the reset-on-reopen decision below.

Persisting scroll offsets by hand would be the alternative, and it is worse: offsets are meaningless until virtualised lists have re-fetched and re-measured, so a restored number lands somewhere arbitrary.

**The boundary that still needs the machine.** `<Activity>` preserves state within a document. VS Code **deallocates** a `WebviewView`'s document when the sidebar is collapsed or the user switches activity-bar container (`retainContextWhenHidden` is a `WebviewPanel` option views do not have — microsoft/vscode#152110), and only `setState`/`getState` survives that. So:

- **Tab switching** (same document) → `<Activity>`, free.
- **Sidebar collapse** (document destroyed) → the machine's `persist`, which must carry `tab` so the panel reopens on the right one.

Breadcrumb depth is deliberately NOT persisted across a deallocation: reopening the panel at the top of a browse tree is a defensible reset, and it avoids restoring a path into a category that a dictionary update may have emptied.

## Kanji browse — data already present

`kanji_characters` supports every axis Shirabe offers, with no schema change:

| axis            | column          | measured                                                                                 |
| --------------- | --------------- | ---------------------------------------------------------------------------------------- |
| By grade        | `grade`         | 1–6 = 80/160/200/202/193/191 (kyōiku), 8 = 1,110 (secondary jōyō), 9–10 = 838 (jinmeiyō) |
| By frequency    | `frequency`     | 2,501 ranked                                                                             |
| By stroke count | `stroke_count`  | all 10,384                                                                               |
| Radicals        | existing picker | reuse `RadicalPicker`                                                                    |

`grade` cleanly yields **Jōyō** (1–8) and **Jinmeiyō** (9–10) groupings, which are two of Shirabe's top-level folders.

## Kanji JLPT — a new dataset, cross-examined

Kanjidic2 ships a `jlpt` field but it is the **pre-2010 four-level scale** (1–4), not today's N5–N1. It cannot be converted arithmetically — measured, the shift is inconsistent: 水 4→N5, 私 3→N4, 難 2→N3 all move by one, but 顔 3→N3 does not. Our own coverage is also lopsided at the beginner end (only 103 kanji at the easiest level).

**Source: [`onlyskin/kanjiapi`](https://github.com/onlyskin/kanjiapi)'s `jlpt.tsv`** — MIT, five lines (one per level), static data rather than a runtime API dependency. Fetch at build time like the other datasets.

Measured on the file:

| level | kanji |
| ----- | ----- |
| N5    | 79    |
| N4    | 166   |
| N3    | 367   |
| N2    | 367   |
| N1    | 1,232 |
| total | 2,211 |

**Zero kanji appear at more than one level**, and **every one of the 2,211 exists in our `kanji_characters` table** — so no rows are dropped and no list is short.

### Cross-check against JLPT Sensei

Because every JLPT list is a community reconstruction, the numbers were compared against [JLPT Sensei](https://jlptsensei.com/jlpt-n5-kanji-list/), the resource a user is most likely to hold us against:

|             | N5  | N4  |
| ----------- | --- | --- |
| ours        | 79  | 166 |
| JLPT Sensei | 80  | 167 |

Diffed character by character, **our N5 is a strict subset of theirs, differing by exactly one kanji: 分** — and 分 is absent from the dataset entirely rather than filed at another level. Two independent community lists agreeing to within one character is about as close as this data gets.

### Two things to state in the UI, so nobody thinks we are wrong

1. **Our counts are PER-LEVEL, not cumulative.** Widely-quoted figures ("N4 = 300 kanji") are cumulative; JLPT Sensei's own per-level count is 167, alongside "about 250 in total including N5". Label the lists per-level explicitly.
2. **172 jōyō kanji have no JLPT level at all** (1,964 of 2,136 covered = 92%). The omissions are systematic, not random: grammar-ish high-frequency characters (分 #24, 的 #105, 無 #274) and prefecture names (岡, 阪, 埼, 茨, 栃, 阜). A footnote like the vocab JLPT view already carries.

Attribution goes in the About view and the DB `meta` provenance, per the standing "attribution is a feature" rule.

## Kana browse

`GOJUON_ROWS` (shared/kana.ts) already lists the 46 base kana, but as a **flat list for the jump rail** — the grid needs its own static table: 5 columns, plus dakuten/handakuten and digraphs, matching Shirabe's Hiragana/Katakana screens.

Small, self-contained, no build-pipeline change. The tab needs **one toggle** (Hiragana ⇄ Katakana) and no drill-down — tapping a kana searches it.

## UI components

- **Tabs** — [React Aria Tabs](https://react-aria.adobe.com/Tabs), rendered at the panel's bottom edge. Note React Aria owns roving focus and arrow-key movement between tabs.
- **Breadcrumbs** — [React Aria Breadcrumbs](https://react-aria.adobe.com/Breadcrumbs) for the Vocab and Kanji drill-down, replacing the current per-level `DetailHeader` back button.

  Shared as `components/BrowseHeader`, and it replaces the level's `<h1>` rather than sitting above it: the last crumb IS the heading, with the count right-aligned on the same row. That keeps the header one row tall at every level, so drilling in no longer shifts the list beneath it.

  The trail's root crumb names **the tab you left** (`Vocab`/`Kanji`), read from `NavContext.tab`. Arriving any other way — a `#tag`, a grammar pill on a word page — is graph traversal with no canonical parent, so it shows ⌂ instead. `DetailHeader` (Back/Home) stays for those views, which is the distinction: a trail answers "where am I in a hierarchy", Back answers "undo my last step".

  **Two React Aria details that cost debugging time.** `Breadcrumbs` renders an `<ol>`, so without `list-style: none` the host stylesheet's decimal markers paint over the trail (this was the ". Browse2. Subject" bug — the marks were never our separator, which is why scoping the `::after` rule never fixed it). And `Link` with `onPress` and no `href` renders a `<span role="link">`, so an `a` selector matches nothing.

## Build sequence

Each step is independently shippable and testable.

1. **Nav root + tabs.** Rename the stack floor, add `tab` to `NavContext`, wrap the four tabs in `<Activity>`, move Browse under Vocab, adopt Breadcrumbs. No new data.
2. **Kanji browse.** Add `jlpt.tsv` to the build + a `kanji_jlpt` column (or table), add a `kanjiList` view, reuse the Browse tree pattern.
3. **Kana grid.** Static table, one toggle.

## Verification

- `vp check` + `vp test --run` green; a bump file per user-facing step.
- **E2E is required, not optional, for step 1** — the tab bar, the machine and the search box interact, and the #16 work showed component tests cannot see that loop. Cover: switching tabs preserves each one's scroll/depth, drilling into a word hides the tabs, Home returns to the tab you left, and the panel reopens on the right tab after a collapse.
- **Kanji JLPT**: a build assertion that all five levels are non-empty and that the level counts match the numbers in this spec, so a silently-changed upstream file fails the build rather than shipping a short list.
