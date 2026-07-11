# Milestone 5 Plan — Morphology & multi-word search

> **Status:** planned. Add real morphological analysis so multi-word queries work (`日本語を勉強します` → 日本語 / を / 勉強 / します, each searchable) with a jisho.org-style POS breakdown UI, and tokenizer-backed deinflection. Read [CONVENTIONS.md](CONVENTIONS.md) first. The engine spike gates everything.

## Context & engine decision

M2's rule-based deinflection handles single conjugated words; multi-word and unspaced Japanese input needs lattice segmentation with part-of-speech knowledge.

**Engine (decided 2026-07):** [**Lindera**](https://github.com/lindera/lindera) compiled to WASM ([lindera-wasm](https://github.com/lindera/lindera-wasm), now developed in the Lindera monorepo) — a Vibrato/MeCab-quality Rust tokenizer, the current state of the art, actively maintained, with published npm+WASM builds and multi-dictionary support. Chosen over a hand-rolled TypeScript Viterbi because the goal is cutting-edge quality and longevity, not owning a tokenizer for its own sake — and crucially the **same WASM artifact runs in both the Node extension host (now) and the M8 web worker (later)**, largely dissolving M8's engine-seam risk. The author's [@saeris/kuromoji](https://github.com/Saeris/kuromoji) (a modernization of 2013-era kuromoji.js, used in [@saeris/remark-ayaji](https://github.com/Saeris/remark-ayaji)) was the original candidate but would lag Lindera/Vibrato from day one.

**What stays purpose-built and ours:** the integration layer — the tokenizer _service_ wrapper, POS normalization, how segments feed search ranking / deinflection, the breakdown UI, and dictionary delivery. That's the project-specific value; the lattice algorithm itself is a solved problem we correctly don't reimplement.

**Grounded facts (verified against npm, 2026-07):**

- Packages split by runtime and dictionary: `lindera-wasm-nodejs-ipadic` (~12.5MB), `lindera-wasm-nodejs-unidic` (~44.7MB), and matching `lindera-wasm-web-*` builds. TypeScript types included. The `nodejs`/`web` split maps directly onto our host (now) / M8 web worker (later).
- Dictionary is **baked into the package** (`embedded://ipadic`), not loaded separately.
- API: `new TokenizerBuilder()` → `set_dictionary("embedded://ipadic")` → `set_mode("normal")` → `build()`, then `tokenizer.tokenize(text)`. Requires **async WASM init** before constructing the builder.
- **CSP:** browser use needs `wasm-unsafe-eval`. The tokenizer runs in the extension _host_ (no CSP), so M5 is unaffected; this is flagged for the M8 web host.

Study references (patterns, not code): **Sudachi** A/B/C split modes (segmentation granularity — Lindera's normal/decompose modes are the analogue; decide which "one segment" means for search); **Fudoki** and **remark-ayaji** for the POS→color UI treatment.

## 1. Spike (gate — do first, record numbers in the as-built)

Install `lindera-wasm-nodejs-ipadic`, tokenize the M2/M3 corpus in the extension-host runtime, and answer with measurements:

- **Token field shape.** Inspect a real token (e.g. tokenize 食べました, 日本語を勉強します): confirm the fields for **surface, part-of-speech, base/dictionary form (lemma/基本形), reading**. Pin these exactly — the rest of the milestone depends on the lemma and POS being available. (MeCab/IPADIC convention exposes them in the feature array; verify Lindera's JS token surfaces them as named fields or a `details`/`features` array.)
- **Init cost & memory.** Time WASM init + tokenizer build, and resident memory with the IPADIC dictionary loaded. Init must be **lazy** (first Japanese multi-word query) and must never block activation. If memory is prohibitive, note it (a worker is the fallback, but the host is already a separate process).
- **Dictionary choice — IPADIC vs UniDic.** IPADIC (12.5MB) is likely `.vsix`-bundleable; UniDic (44.7MB) likely needs download-alongside-the-DB via the existing `dictionary-latest` machinery. Tokenize the corpus with IPADIC first; only pursue UniDic if IPADIC's segmentation/lemmas are visibly worse on real queries. Record the decision with examples.
- **Extension-host load.** Confirm the WASM instantiates under the Node host (the `nodejs` build; no CSP there). Note for M8: the `web` build + `wasm-unsafe-eval` CSP is the web-host path — record, don't build.
- **Quality sanity.** Confirm lemmas match what M2 deinflection produces (します → する, 食べた → 食べる, たかくない → 高い) and that 日本語を勉強します segments into 日本語 / を / 勉強 / します.

**If the spike fails its budget** (size, memory, startup, or the WASM won't load in the host): record why, keep M2's rule table as the deinflection story, and demote the remaining items to the backlog. Don't force it.

### Spike results (2026-07, `lindera-wasm-nodejs-ipadic@2.0.0`) — PASS

- **Token fields are named properties** (no feature-array parsing): `surface`, `baseForm` (lemma/基本形), `partOfSpeech` + `partOfSpeechSubcategory1..3`, `reading`, `pronunciation` (katakana), `conjugationForm`, `conjugationType`, `byteStart`/`byteEnd`, `wordId`. Our `Segment` maps directly: surface←surface, lemma←baseForm, reading←reading, pos←partOfSpeech.
- **Segmentation/lemmas are excellent** and a strict superset of M2 deinflection:
  - `日本語を勉強します` → 日本語[名詞] を[助詞] 勉強[名詞] し[する·動詞] ます[ます·助動詞]
  - `食べました` → 食べ[食べる] まし[ます] た[た]; `たかくない` → たかく[たかい] ない; `話します` → 話し[話す] ます
- **Load model (nodejs build):** WASM loads **synchronously at `require`** (CommonJS `__wbindgen_placeholder__` pattern) — **no async init needed in the host** (simpler than the docs' web-build `__wbg_init().then()`). Cost: require ~17ms, `builder.build()` **~193ms** (one-time, lazy), `tokenize()` **~4ms**. RSS with IPADIC loaded ~188MB — acceptable (host is a separate process); keep init lazy so it's paid only on the first Japanese multi-word query.
- **Config:** `new TokenizerBuilder()` → `setDictionary("embedded://ipadic")` → `setMode("normal")` → `build()`. (camelCase methods, not the `set_dictionary` snake_case the rustdoc showed.)
- **Dictionary:** IPADIC quality is sufficient on the corpus — **stay on IPADIC**, don't pursue the 44.7MB UniDic. 12.5MB unpacked.
- **Segment granularity note:** IPADIC splits サ変 compounds (勉強+する) — so the searchable "content unit" is the noun (勉強), with する/ます as suffixes. The POS mapping/UI coalesces these (a 名詞 followed by する→one searchable segment, or just present the noun as the tappable unit).

## 2. Tokenizer service in the host

`src/host/tokenizer.ts`: a lazy-initialized singleton wrapping Lindera, exposing `segment(text): Promise<Segment[]>` where `Segment = { surface, lemma, pos, reading? }` — a plain DTO. WASM init + builder happen once on first call, cached. POS values normalized to a small enum the UI can color (`noun | verb | particle | adjective | adverb | auxiliary | other`) by mapping IPADIC's Japanese POS taxonomy (名詞, 動詞, 助詞, 形容詞, 副詞, 助動詞…) once, here. `@tursodatabase/*`-style: the lindera package is `neverBundle`d if it ships a `.node`/wasm asset the loader resolves at runtime — determine during the spike and set `pack.deps` + `.vscodeignore` accordingly (mirror the turso packaging pattern). Unit tests against known sentences.

## 3. Multi-word search + POS breakdown UI

- **Contract:** `SearchResponse` gains `segments: SegmentDto[]` (present only when a Japanese query tokenizes into >1 content segment). Recommended split: the **host returns segments; the UI drives per-segment searches** through the existing search query — no new merge semantics in the host, the breakdown bar just re-searches the tapped segment's lemma. The default results stay the full-query search (or the first content segment if the whole query matched nothing).
- **UI:** a segment bar above results (jisho.org's breakdown, Ayaji's coloring): each segment a tappable chip, POS-colored via CVA variants, theme-aware — derive colors from `--vscode-charts-*` variables, never hardcode. Tapping a chip searches that segment's lemma; particles render dimmed (tappable to the particle's own entry is optional — Shirabe lists particles). Latin/English queries never invoke the tokenizer.
- **Machine:** selected-segment index is UI state → navigation-machine context beside `searchQuery`.

**Success:** typing 日本語を勉強します shows a 4-chip breakdown; tapping 勉強 searches 勉強; particles are visually distinct; English queries show no breakdown and never load the tokenizer.

## 4. Tokenizer-backed deinflection (+ the deferred keyboard-nav items)

- Prefer the tokenizer's lemma over M2's rule table for Japanese queries (します → する with POS context, no over-generation). Keep `deinflect.ts` as the fallback for: tokenizer-not-yet-initialized, unknown words (dictionary misses slang/rare forms), and the romaji→kana path. Lemma candidates enter the existing 90-score merge channel in `Dictionary.search` unchanged. Update [BACKLOG.md](BACKLOG.md) #8 (the deinflection-hardening item) — the tokenizer supersedes its motivation.
- **Keyboard navigation (BACKLOG #11 + #12), folded in here** since #11's word-boundary detection overlaps tokenization: #12 (↓ from the search box into the results list; ↑/Esc back to the input) is independent and small — ship it. #11 (Duolingo-style autocomplete strip with the ↑-into-suggestions / ←-to-exact-input model) is large and interacts with the host OS IME; **spike its IME coexistence first** (in a desktop VSCode webview the OS IME already augments the field — clarify what we add) and only build if it's clearly worth it. If #11 proves murky, ship #12 alone and leave #11 in the backlog.

## Build order & verification

1 (spike — gate) → 2 (service) → 3 (breakdown UI + multi-word) → 4a (lemma deinflection) → 4b (#12 arrow-nav; #11 autocomplete only if its spike passes). Per-item commits + bump files (item 3 is `minor`). Standing gates per CONVENTIONS; tokenizer init must not regress activation time (measure); verify host externals stay expected after adding lindera; F5 pass for the breakdown UI. Append as-built deviations + flip ROADMAP status.

## As-built deviations

Where the shipped implementation differs from the plan above:

- **No async WASM init in the host.** The plan (from the web-build docs) assumed a `__wbg_init().then()` gate. The `nodejs` build instead loads its WASM when the module is imported, so the tokenizer service just uses a **dynamic `import()`** (idiomatic ESM, chosen over `require` for consistency with the codebase) — lazy, cached, no init dance.
- **Segment granularity coalescing.** IPADIC splits サ変 compounds (勉強+する) and verb+auxiliary chains (食べ+まし+た). `tokenizer.ts` coalesces trailing する / auxiliaries / suffixal tokens onto the preceding content word so a "segment" is a searchable unit (勉強します → one 勉強·verb segment). Particles/auxiliaries stay separate for the dimmed chips.
- **Deinflection kept `Dictionary` tokenizer-agnostic.** Rather than importing the tokenizer into the DB layer, `search` gained an `extraLemmas` param; `extension.ts` tokenizes once (`analyzeQuery`) and feeds both the breakdown segments and the content lemmas. The M2 rule table stays as the fallback.
- **#11 autocomplete ruled out, not just deferred.** Research (recorded in [BACKLOG.md](BACKLOG.md) #11) found the web platform cannot override the OS IME candidate window (non-cancelable composition `beforeinput`; `chrome.input.ime` is ChromeOS-only), so the Duolingo-style strip isn't viable on desktop. #12 (arrow-nav) shipped; #11 stays deferred with a settled technical rationale.
- **Packaging verified end-to-end.** Lindera ships unbundled in the `.vsix` (13MB `.wasm` + loader confirmed present); the dynamic `import()` stays externalized in the host bundle. `wasm-unsafe-eval` CSP is not needed in the host (no CSP there); it's the M8 web-host concern, already noted in M8-PLAN.
- **BACKLOG #8** (deinflection-table hardening) marked largely superseded — the tokenizer supplies accurate lemmas.
- **Tokenizer gate requires kanji, not just "any Japanese" (F5 finding).** The initial gate tokenized any Japanese query ≥2 chars. Testing showed all-kana input (`にほんごをはなしますか`) produces a garbage breakdown — IPADIC's Viterbi lattice depends on kanji↔kana script transitions to find word boundaries, and pure-kana runs have no such signal, so it fragments into noise (`に·ほん·ご·を…`). The gate now requires at least one kanji (`HAS_KANJI`); pure-kana and romaji fall through to rule-based deinflection (`はなします → 話す`), which is the correct tool for them. This also stops junk lemmas from all-kana tokenization polluting search. The same query *with* kanji (`日本語を話しますか`) still segments cleanly.
- **Known UX gaps left as later polish (F5 findings):** (a) tapping a breakdown chip does a destructive re-search of that lemma rather than filtering the sentence in place (jisho.org keeps the sentence and moves between fragments) — you can't return to the previous fragment; (b) on Windows the OS IME requires Tab/Enter to commit composition before our field sees committed text (expected OS behavior, and exactly the IME reality that ruled out BACKLOG #11). Neither blocks the milestone.
