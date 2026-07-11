# Milestone 6 Plan — Enrichment datasets

> **Status:** planned. Layer the remaining reference data onto existing views: pitch accent, example sentences, JLPT word lists, WaniKani citations, and the names dictionary. Read [CONVENTIONS.md](CONVENTIONS.md) first.

## Context

Each item is a data-build addition plus a detail-view section, independent of the others — this milestone can be split, reordered, or partially shipped freely. Every item extends attribution (About view + README + `meta`) in its own commit, per CONVENTIONS. Every item changes the schema, so each lands with rebuilt variants and a `dictionary-latest` refresh — batch uploads if shipping several items close together.

## 1. Pitch accent (Kanjium)

**Source:** [mifunetoshiro/kanjium](https://github.com/mifunetoshiro/kanjium) — `data/source_files/raw/accents.txt`, a TSV of ~124k rows: `kanji-or-kana ⇥ reading (empty when the first column is the reading) ⇥ accent pattern(s)`. Patterns are mora numbers (`0` = heiban/flat, `1` = atamadaka, n = downstep after mora n; comma-separated when multiple, sometimes annotated). A word can have several rows/patterns ordered by commonness.

**Build:** fetch the raw file from GitHub, join to JMdict entries by (kanji text, kana text) pair — fall back to kana-only match for kana-only words. Store `pitch_accents(word_id, reading, accents_json)`. Expect imperfect join coverage; count and record the match rate in the as-built (spot-check misses — mismatched okurigana variants are the usual cause).

**UI:** show pitch on `WordDetail` next to each reading. Start with the compact numeric notation styled as a badge (e.g. たべる [2]); the graphical overline/downstep rendering (Shirabe-style) is a follow-up — if attempted, render as inline SVG over the kana, driven by mora segmentation (split kana into moras: small ゃゅょ attach to the previous kana).

**License:** Kanjium data is under the same terms as its sources (accent data derived from NHK/Wadoku work — verify the repo's current license statement when implementing and mirror it in attribution).

**As-built:** Kanjium `accents.txt` confirmed CC BY-SA 4.0 (repo README credits Uros O.; underlying EDICT/KANJIDIC provenance already ours). `accents.txt` pinned to commit `8a0cdaa`; parser strips `(POS)` annotations and handles the empty-reading (kana-only) rows. Join keyed on `surface\treading` (surface = a kanji writing, or the reading itself), matched **per reading** so multi-reading words (日本語 にほんご/にっぽんご) get distinct patterns. 22,422 (word, reading) rows on the common DB. Shipped first as the numeric badge (`6e762c9`), then the **graphical overline/downstep contour** (the planned follow-up, done after the Shirabe reference screenshots): `src/webview/pitch.ts` does mora segmentation (yōon fuse; sokuon/長音 stand alone) + contour derivation (heiban/atamadaka/nakadaka/odaka), rendered by `PitchAccent.tsx` as per-mora CSS overline + downstep border over the kana, with the number in the tooltip. The numeric `PitchBadge` was removed. Unit-tested in `pitch.spec.ts`.

## 2. Example sentences (Tatoeba / Tanaka corpus)

**Source decision (verify at implementation):** jmdict-simplified publishes a `jmdict-examples-eng-*` variant with sentences embedded per sense (from `JMdict_e_examp`, i.e. the Tanaka corpus maintained by Tatoeba) — but its README notes the npm **types don't cover it**. Preferred path: switch the **full** build's source asset to the examples variant and extend the types locally (a `JMdictSenseWithExamples` extension — the examples element carries source text, sentence pairs ja/en). Alternative: ingest Tatoeba's sentence exports directly and join — much more work; only if the examples variant proves unusable.

**Build:** `sentences(word_id, sense_position, ja, en)` capped per sense (~3–5). **Measure DB size impact before shipping** — sentences are the biggest text addition yet; if the full DB grows past ~500MB, cap harder or make sentences a separate optional download (decide with numbers).

**UI:** collapsible "Examples" section per sense in `WordDetail`, ja sentence with en translation. Tap-through on sentence words is **deferred** until M5's tokenizer exists (extend the M2 xref-link treatment then).

**License:** Tatoeba/Tanaka corpus is CC-BY 2.0 FR — attribution required.

## 3. JLPT word lists — source & join revised after M6 research

**Source (revised 2026-07):** [**stephenmk/yomitan-jlpt-vocab**](https://github.com/stephenmk/yomitan-jlpt-vocab) (CC-BY-SA-4.0), a curated modern reissue of Jonathan Waller's (tanos.co.uk) N5–N1 lists. Chosen over the original plan's "fetch tanos CSVs" because:

- **tanos.co.uk publishes no CSV** — only Word/PDF/Anki/Mnemosyne. Every machine-readable path is a derivative.
- This source is **JMdict-ID-aligned**: `original_data/n{1..5}.csv` columns are `jmdict_seq,kana,kanji,waller_definition`, and `jmdict_seq` is the JMdict entry sequence number — i.e. **our `words.id`**. So the join is an exact PK match (`words.id = jmdict_seq`), not the plan's lossy kanji+kana text match. Verified against the built common DB: all sampled N5 ids (会う 1198180, 青 1381380, …) hit `words.id` exactly. This removes the plan's "expect imperfect join coverage" risk.
- It **corrects** Waller's rare-spelling variants to common forms and picks representations via JMdict frequency (per its README).
- Row counts: N5 684, N1 3,427 (per-level CSVs pinned to commit `b062d4e`).

**On the unofficial nature (settled):** there is no official JLPT vocab list and never has been — the Japan Foundation stopped publishing lists after the 2010 redesign, so every N5–N1 list is a community reconstruction. **This is the industry norm, not a blocker:** [Jisho.org](https://jisho.org/about) ships Waller's lists and credits him ("Information about what word and kanji belong to which JLPT level comes from Jonathan Waller's JLPT Resources page") with no caveat. We'll do the same but add a **subtle "unofficial" affordance** (tooltip on the badge) since stephenmk's README is honest about it (even Waller's N1 list contained words that appeared on the N2 exam). Note we _also_ already ship Kanjidic2's per-_kanji_ `jlptLevel` (old 1–4 scale) on kanji results/detail — that's separate and stays.

**Build:** fetch the five per-level CSVs, parse `jmdict_seq`+level, `UPDATE words SET jlpt = ?` by id (N5=5 … N1=1). Record the match rate (ids present in JMdict / total list rows) in `meta`; spot-check a few known words per level. Store as `words.jlpt` (5–1, null otherwise).

**UI:** JLPT badge (new CVA badge kind) on result rows and `WordDetail`, with a tooltip noting it's an unofficial estimate (Waller/tanos). A browsable "JLPT lists" view (new machine view; query words by level, common-first) is **deferred to a follow-up** — the badge is the immediate value; the list view is separate chrome. Search filter (`#n5 water`) out of scope.

## 4. WaniKani citations (links only)

No dataset ingestion (WK content requires an API key and its license doesn't permit redistribution): on `WordDetail`/`KanjiDetail`, render an outbound link `https://www.wanikani.com/search?query=<term>` (or the direct `/vocabulary/<slug>` and `/kanji/<char>` URL forms — verify slug format at implementation). A small "WK" affordance next to the headword; links open externally (webview anchors already do).

## 5. JMnedict names dictionary

**Source:** `jmnedict-all-*.json` from the same jmdict-simplified release (~743k name entries, ~146MB source JSON; types exist in the installed types package — `JMnedictWord` with `translation` instead of `sense`).

**Design constraint:** this roughly doubles the delivered DB. Decide with measurements: (a) include in `jisho-full.db` if the total stays tolerable (<600MB), or (b) build a **separate optional** `jisho-names.db` asset on `dictionary-latest`, downloaded on demand when the user enables names (a setting + second `Dictionary` instance — `ensureDatabase` generalizes to named artifacts). Lean (b); it also rehearses the multi-artifact delivery M5's tokenizer dictionaries may need.

**Build/UI:** `names` tables mirroring the word tables but simpler (kanji/kana/translation-type/translation); search kind `name` (exact/prefix only); a third results section "Names" capped at ~5, expandable; name detail can reuse a simplified `WordDetail` variant (name-type badges: person/place/company/…).

## Build order & verification

Suggested (revised): **3 (JLPT — starting here; source/join settled during research)** → 1 (pitch) → 2 (sentences) → 4 (WK links) → 5 (names — largest). Per-item commits + bump files (each user-facing item is `patch`; names is `minor`). Standing gates per CONVENTIONS: both build variants, `dictionary-latest` refresh per schema change, latency re-probe after items 2 and 5 (table growth), attribution extended per item. Append as-built + flip ROADMAP status.
