# Spec 13 — Tokenizer-layer accuracy: correction passes over IPADIC output

**Backlog:** follows spec 12 (§5 "still open"). **Status:** SCOPING — mechanisms probed against the real tokenizer (2026-07-26), fixes ranked, sequence proposed. No code yet; this is for sign-off before building.

## Why this is separate from spec 12

Spec 12 fixed `resolveByLemma` — given a correct `(lemma, POS, reading)` from the tokenizer, pick the right entry. That layer is now solid (reading tier, uk-display, sense breadth; the accuracy gate holds at 1.000 on decidable words). The remaining failures the corpus sweep surfaced are **upstream**: the tokenizer hands `resolveByLemma` the wrong lemma, or shatters a word before it ever gets there. No ranking change can fix a wrong input.

The tokenizer is **Lindera + embedded IPADIC (WASM)**, `mode=normal`. We already post-process its raw tokens in `segment()` (POS map, サ変-coalescing, suffix folding) — that loop is the natural seam for correction passes. The raw `LinderaToken` carries more than `lindera.d.ts` currently exposes: `conjugationForm`, `conjugationType`, `partOfSpeechSubcategory1/2/3`, `pronunciation`, `wordId`. **Any correction pass first widens the `.d.ts`** to expose the fields it branches on.

## The failures are THREE different mechanisms (not one bug)

Probed with real raw tokens. Lumping them into one "correction pass" would be the wrong abstraction — each needs a different tool, has different risk, and some are genuinely not worth fixing.

### A. Glued honorific prefix — `お送り` (FIXABLE, low risk, high value)

`お送りいたします` → IPADIC emits one token `{surface:お送り, baseForm:お送り, subcat1:サ変接続}`. The honorific お is glued into the base, so the lemma is お送り, which has no entry — resolves to null. Same for ご連絡, お問い合わせ.

**The rule is decidable against the DB** (probed): strip お/ご **only when the prefixed form is NOT an entry AND the stripped remainder IS.**

| form                           | prefixed entry exists? | stripped entry exists? | action                              |
| ------------------------------ | ---------------------- | ---------------------- | ----------------------------------- |
| お送り / お問い合わせ / ご連絡 | no                     | yes                    | **strip** ✓                         |
| お茶 / お金 / ご飯 / お願い    | yes (lexicalized)      | yes                    | **keep** — お茶 IS the word, not 茶 |

The lexicalized cases (お茶/ご飯) keep their honorific correctly because the prefixed form exists as its own entry. Zero false strips in the probe set.

**Where it lives:** cleanest as a FALLBACK inside `resolveByLemma`, not the tokenizer — the tokenizer stays DB-free, and `resolveByLemma` already queries the DB. When a lemma starting お/ご resolves to null, retry once with the prefix stripped. This is the honorific analogue of the サ変 base-noun fallback deinflection already does. Small, self-contained, testable, and it only ever activates on an otherwise-null resolution (can't regress a working case).

**As built (2026-07-26):** `resolveByLemma` splits into a `#resolveExact` core + the public method that tries it, then retries once with `stripHonorific` (お/ご + ≥2-char remainder). Verified: お電話→電話, ご案内→案内, ご住所→住所, ご意見→意見; lexicalized お茶/ご飯/お願い/お名前/お時間 resolve directly and keep their own heading (never reach the fallback). Two boundaries the build surfaced, both recorded, neither a bug:

- **IPADIC glues honorifics INCONSISTENTLY.** お送り/お電話 come through as one glued token, but 担当者がご案内いたします tokenizes ご as its OWN 接頭詞 token with lemma 案内 already correct — so the fallback isn't even reached there. The fallback fixes the glued cases; the split cases were never broken. The unit test drives the glued form directly (`resolveByLemma("ご案内")`), the reliable surface to test on, rather than a sentence whose gluing is IPADIC's whim.
- **Verb-stem humbles need deinflection, not just stripping.** お送り is お + a verb REN'YŌKEI (送り), whose dictionary form is 送る — stripping お lands on the noun 送り (a real but wrong entry). Reaching 送る needs the deinflection engine, beyond a prefix strip. Left as a documented `optional` gold case, deferred.

### B. Missing slang / colloquial adjectives — `きもい`, `やばい` (FIXABLE, medium effort, bounded)

`きもい虫` → IPADIC has no きもい entry, so the lattice shatters it into garbage (き=来る + も + い=いる + 虫). やばい tokenizes (it's now common enough to be in IPADIC) but many slang adjectives don't. The word is gone before `segment()` sees a coherent token — post-processing can't reassemble it.

**The only real fix is a custom user dictionary** fed to Lindera (`TokenizerBuilder` supports a user dict alongside the embedded one). Populate it with a curated list of high-frequency colloquial words IPADIC lacks (きもい, うざい, ちゃんと-ish forms, contractions) as their correct POS + reading + lemma. Bounded effort: the build wires a user-dict file, and the list is hand-curated (tens of entries, not thousands). Risk: a user-dict entry can mis-fire on unintended inputs, so each entry needs a test in the corpus.

**Open question for sign-off:** is slang coverage worth a user-dict mechanism for v1, or is it acceptable that pure-slang input (きもい) degrades? Everyday casual speech leans on it, but it's a longer tail than A.

### C. Lattice mislemma — `雨が降りそう` → 降りる not 降る (NOT cheaply fixable — likely out of scope)

`雨が降りそうだ` → IPADIC tokenizes 降り as `{baseForm:降りる}` (descend), but in context 雨が降る it's 降る (fall). 降り is the 連用形 of BOTH verbs; the lattice picked 降りる. This is a genuine **disambiguation error inside the lattice**, not a post-processing gap — `segment()` receives a single, confident, wrong token with no signal that it's ambiguous.

Fixing it means real context disambiguation (雨/雪 + 降り → 降る) — a rule engine or a better-weighted dictionary, both high-effort and high-risk of new mis-fires. **Recommend: out of scope.** Note it as a known limitation; the hover shows a plausible related verb, not garbage. Reassess only if these prove common in real use (this is the only instance the sweep found).

## Recommended sequence

1. **A (honorific fallback)** — do first. Small, safe (null-only fallback), high value, no tokenizer change. Widen `lindera.d.ts` is not even needed (it's a `resolveByLemma` DB fallback). Gold + db.spec cases: お送り→送る, ご連絡→連絡, and the lexicalized keepers (お茶 stays お茶).
2. **B (user dictionary)** — only if sign-off says slang matters for v1. Bigger surface (build wiring + curated list + per-entry tests). Widens `lindera.d.ts` if the entries need conjugation fields.
3. **C (lattice mislemma)** — defer/out of scope; record as a known limitation in spec 12 §5.

## Verification

- A: `db.spec.ts` — お送り/ご連絡/お問い合わせ resolve to the stripped verb/noun; お茶/ご飯/お願い/お金 keep their prefixed entry (no false strip). A gold regression (`資料をお送りいたします` — currently `optional`, would become a hard expectation).
- B: each user-dict entry gets a corpus sentence (きもい, etc.) that must resolve; plus a guard that the entry doesn't mis-fire on adjacent input.
- Throughout: the existing accuracy gate stays green; per-register precision holds or rises.
