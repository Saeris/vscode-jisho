# Spec 11 — Kanji word-list frequency sort

**Backlog:** #30-adjacent. **Status:** **Implemented** (2026-07-24). One query change in `getKanji` + an ordering-invariant test in `db.spec.ts`; no schema change. Verified on the full DB — the everyday words now lead (水 → 水/水準/水道/水面 instead of 水俣病/水道水/湧水; 生 → 学生/生活/人生/先生 instead of お誕生日/小中学生; 見 → 意見/会見/発見 instead of 様子を見る/お見積もり).

## Objective

On the kanji detail page, the "words containing this kanji" list floats common terms but, _within_ "common", the order is arbitrary — so a rare common-tagged word can sit above 食べる. Sort by genuine frequency so the most useful words lead.

## The finding (do not re-research)

`getKanji`'s word list is today:

```sql
SELECT word_id, MAX(is_common) AS common FROM search_terms
 WHERE kind = 'char' AND term = ?
 GROUP BY word_id
 ORDER BY common DESC
 LIMIT 10
```

`ORDER BY common DESC` alone leaves ties unbroken. The `words.freq_rank` column (JMdict nfXX buckets; 1 = the 500 most frequent, lower = more frequent, NULL = outside the top ~24,000) **already exists** and already drives search ranking — so the fix is to add it as the tiebreak, not to compute anything new.

## Decision (do not relitigate)

Order **common-first, then genuine frequency**: `ORDER BY common DESC, freq_rank IS NULL, freq_rank ASC`. `freq_rank IS NULL` sinks the unranked (NULL) words below the ranked ones (SQLite sorts NULL first by default, which is backwards here); `freq_rank ASC` then puts the most frequent first. The `LIMIT 10` stays.

The query joins `words` for `freq_rank` (the current query reads only `search_terms`), keyed by `word_id`.

## Verification

- A kanji whose common words include a rare one: the frequent word leads (Rule 9 — pick a case where the OLD order demonstrably differs, e.g. a common everyday word vs a rare common-tagged compound sharing the kanji).
- Existing `getKanji` tests stay green (the list still returns ≤10, still common-first).
