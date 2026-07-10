# Milestone 6 Plan — Enrichment datasets

> **Status:** planned. Layer the remaining reference data onto existing views: pitch accent, example sentences, JLPT word lists, WaniKani citations, and the names dictionary. Read [CONVENTIONS.md](CONVENTIONS.md) first.

## Context

Each item is a data-build addition plus a detail-view section, independent of the others — this milestone can be split, reordered, or partially shipped freely. Every item extends attribution (About view + README + `meta`) in its own commit, per CONVENTIONS. Every item changes the schema, so each lands with rebuilt variants and a `dictionary-latest` refresh — batch uploads if shipping several items close together.

## 1. Pitch accent (Kanjium)

**Source:** [mifunetoshiro/kanjium](https://github.com/mifunetoshiro/kanjium) — `data/source_files/raw/accents.txt`, a TSV of ~124k rows: `kanji-or-kana ⇥ reading (empty when the first column is the reading) ⇥ accent pattern(s)`. Patterns are mora numbers (`0` = heiban/flat, `1` = atamadaka, n = downstep after mora n; comma-separated when multiple, sometimes annotated). A word can have several rows/patterns ordered by commonness.

**Build:** fetch the raw file from GitHub, join to JMdict entries by (kanji text, kana text) pair — fall back to kana-only match for kana-only words. Store `pitch_accents(word_id, reading, accents_json)`. Expect imperfect join coverage; count and record the match rate in the as-built (spot-check misses — mismatched okurigana variants are the usual cause).

**UI:** show pitch on `WordDetail` next to each reading. Start with the compact numeric notation styled as a badge (e.g. たべる [2]); the graphical overline/downstep rendering (Shirabe-style) is a follow-up — if attempted, render as inline SVG over the kana, driven by mora segmentation (split kana into moras: small ゃゅょ attach to the previous kana).

**License:** Kanjium data is under the same terms as its sources (accent data derived from NHK/Wadoku work — verify the repo's current license statement when implementing and mirror it in attribution).

## 2. Example sentences (Tatoeba / Tanaka corpus)

**Source decision (verify at implementation):** jmdict-simplified publishes a `jmdict-examples-eng-*` variant with sentences embedded per sense (from `JMdict_e_examp`, i.e. the Tanaka corpus maintained by Tatoeba) — but its README notes the npm **types don't cover it**. Preferred path: switch the **full** build's source asset to the examples variant and extend the types locally (a `JMdictSenseWithExamples` extension — the examples element carries source text, sentence pairs ja/en). Alternative: ingest Tatoeba's sentence exports directly and join — much more work; only if the examples variant proves unusable.

**Build:** `sentences(word_id, sense_position, ja, en)` capped per sense (~3–5). **Measure DB size impact before shipping** — sentences are the biggest text addition yet; if the full DB grows past ~500MB, cap harder or make sentences a separate optional download (decide with numbers).

**UI:** collapsible "Examples" section per sense in `WordDetail`, ja sentence with en translation. Tap-through on sentence words is **deferred** until M5's tokenizer exists (extend the M2 xref-link treatment then).

**License:** Tatoeba/Tanaka corpus is CC-BY 2.0 FR — attribution required.

## 3. JLPT word lists (tanos.co.uk)

**Source:** Jonathan Waller's JLPT N5–N1 vocab lists at tanos.co.uk (CC-BY). These are word-level JLPT (Kanjidic's `jlpt` is kanji-level and uses the old 4-level scale). Fetch the list pages/CSVs in the data build; join to JMdict by kanji+kana (fall back kana-only). Store as `words.jlpt` column (5–1, null otherwise).

**UI:** JLPT badge (new CVA badge kind) on result rows and `WordDetail`; a browsable "JLPT lists" view (new machine view; query words by level, common-first) reachable from the About/search area. Search filter (e.g. typing `#n5 water`) is out of scope.

## 4. WaniKani citations (links only)

No dataset ingestion (WK content requires an API key and its license doesn't permit redistribution): on `WordDetail`/`KanjiDetail`, render an outbound link `https://www.wanikani.com/search?query=<term>` (or the direct `/vocabulary/<slug>` and `/kanji/<char>` URL forms — verify slug format at implementation). A small "WK" affordance next to the headword; links open externally (webview anchors already do).

## 5. JMnedict names dictionary

**Source:** `jmnedict-all-*.json` from the same jmdict-simplified release (~743k name entries, ~146MB source JSON; types exist in the installed types package — `JMnedictWord` with `translation` instead of `sense`).

**Design constraint:** this roughly doubles the delivered DB. Decide with measurements: (a) include in `jisho-full.db` if the total stays tolerable (<600MB), or (b) build a **separate optional** `jisho-names.db` asset on `dictionary-latest`, downloaded on demand when the user enables names (a setting + second `Dictionary` instance — `ensureDatabase` generalizes to named artifacts). Lean (b); it also rehearses the multi-artifact delivery M5's tokenizer dictionaries may need.

**Build/UI:** `names` tables mirroring the word tables but simpler (kanji/kana/translation-type/translation); search kind `name` (exact/prefix only); a third results section "Names" capped at ~5, expandable; name detail can reuse a simplified `WordDetail` variant (name-type badges: person/place/company/…).

## Build order & verification

Suggested: 3 (JLPT — smallest, immediate badge value) → 1 (pitch) → 2 (sentences) → 4 (WK links) → 5 (names — largest). Per-item commits + bump files (each user-facing item is `patch`; names is `minor`). Standing gates per CONVENTIONS: both build variants, `dictionary-latest` refresh per schema change, latency re-probe after items 2 and 5 (table growth), attribution extended per item. Append as-built + flip ROADMAP status.
