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

**Lindera supports user dictionaries — the OFF-THE-SHELF WASM package doesn't expose them usably (probed 2026-07-26, then confirmed against the docs).** `lindera-wasm-nodejs-ipadic`'s `setUserDictionary(uri)` throws `LinderaError(kind=Io, "Failed to open user dictionary CSV file")` for every URI form (absolute path, `file://`, relative). Per the Lindera WASM docs (`lindera-wasm/dictionary_management.html`, `.../opfs.html`), this is a PACKAGING choice, not a Lindera limitation:

- The WASM's `loadUserDictionary(path, metadata)` reads from the WASM's own IO layer, which the `nodejs` package wires for its OPFS/browser story, not arbitrary host paths — hence the failure.
- The MAIN dictionary already has an in-memory path: `loadDictionaryFromBytes(metadata, dictDa, dictVals, …)` takes the 8 component `Uint8Array`s directly (this is what OPFS uses). There is no documented _user_-dictionary equivalent taking bytes — `loadUserDictionary` is path-only.
- OPFS itself is **browser-only** (Chrome 86+/FF 111+/Safari 15.2+, secure context) — irrelevant to our Node extension host.

So three real routes exist, in increasing cost. The earlier note ("impossible, do not re-attempt") was WRONG — corrected here:

1. **Post-tokenizer re-stitch overlay** (application code, no WASM change). Keep a small curated map of slang surfaces IPADIC shatters (きもい, うざい, …) → POS/lemma/reading; in `segment()`, scan the ORIGINAL input and where a mapped surface spans tokens IPADIC broke apart (き|も|い), replace that run with one synthetic segment. Bounded (fires only on exact hardcoded surfaces), fully testable, no supply-chain change. Downsides: curated list only (no lattice generalization), and re-stitching by byteStart/byteEnd offset is fiddly. The slang LIST can live in a DB table or a TS constant — the MECHANISM is text-matching in `segment()`, since the word never becomes a lookupable token.
2. **Build our own lindera-wasm** (`wasm-pack build --release --features=cjk --target=bundler`) with a user dictionary embedded at build time (compile CSV → binary, bundle it). This is the "proper" fix and gives lattice-level integration (きもい tokenizes correctly, generalizes across inflections). Cost: a Rust + wasm-pack toolchain in CI, ownership of a forked/custom build, and the maintenance that implies — a real supply-chain addition for a longer-tail win.
3. **Defer** — accept that pure-slang input (きもい) degrades for v1; the honorific win (A) already shipped.

**Open question for sign-off:** #1 (limited, cheap, in our code), #2 (general, but we take on a custom WASM build), or #3 (defer)? B is a longer tail than A regardless; #2's cost is the crux — a maintained Rust→WASM build step is a meaningful addition to a project that currently consumes the tokenizer off the shelf.

### C. Lattice mislemma — `雨が降りそう` → 降りる not 降る (NOT cheaply fixable — likely out of scope)

`雨が降りそうだ` → IPADIC tokenizes 降り as `{baseForm:降りる}` (descend), but in context 雨が降る it's 降る (fall). 降り is the 連用形 of BOTH verbs; the lattice picked 降りる. This is a genuine **disambiguation error inside the lattice**, not a post-processing gap — `segment()` receives a single, confident, wrong token with no signal that it's ambiguous.

Fixing it means real context disambiguation (雨/雪 + 降り → 降る) — a rule engine or a better-weighted dictionary, both high-effort and high-risk of new mis-fires. **Recommend: out of scope.** Note it as a known limitation; the hover shows a plausible related verb, not garbage. Reassess only if these prove common in real use (this is the only instance the sweep found).

## Recommended sequence

1. **A (honorific fallback)** — do first. Small, safe (null-only fallback), high value, no tokenizer change. Widen `lindera.d.ts` is not even needed (it's a `resolveByLemma` DB fallback). Gold + db.spec cases: お送り→送る, ご連絡→連絡, and the lexicalized keepers (お茶 stays お茶).
2. **B (slang coverage)** — three routes (see §B), pending sign-off: (1) post-tokenizer re-stitch overlay (cheap, curated, in our code), (2) a custom lindera-wasm build with an embedded user dictionary (general, but adds a Rust/wasm-pack build step we'd own), or (3) defer. The off-the-shelf package can't load a user dict, but that's a packaging limit, not a Lindera one.
3. **C (lattice mislemma)** — defer/out of scope; record as a known limitation in spec 12 §5.

## Verification

- A: `db.spec.ts` — お送り/ご連絡/お問い合わせ resolve to the stripped verb/noun; お茶/ご飯/お願い/お金 keep their prefixed entry (no false strip). A gold regression (`資料をお送りいたします` — currently `optional`, would become a hard expectation).
- B: each user-dict entry gets a corpus sentence (きもい, etc.) that must resolve; plus a guard that the entry doesn't mis-fire on adjacent input.
- Throughout: the existing accuracy gate stays green; per-register precision holds or rises.
