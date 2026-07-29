# Slang user dictionary (`slang-userdict.csv`)

A Lindera **user dictionary** of colloquial/slang words IPADIC lacks, layered on top of the main
IPADIC dictionary at tokenize time (spec 13 §B / spec 14). Without it, a word like きもい shatters
into き+も+い and never reaches the dictionary as one unit.

Only add words IPADIC genuinely **lacks** — much everyday slang (やばい, だるい, えぐい, きしょい, 草,
推し, めっちゃ, マジ, ガチ …) is already in IPADIC 4.x. Check first: tokenize the word with the base
dictionary; if it comes back as one token, don't add it. The current list (probed against IPADIC
4.x) spans a few categories:

- **i-adjectives**: きもい, うざい, エモい, ちゃちい, エロい, グロい
- **modern nouns**: ワンチャン, コスパ, タイパ, リア充, 陰キャ, 陽キャ, ぼっち, ガチ勢
- **adverb / interjections**: めちゃ, どんまい, やったー, そっか, まじか
- **contractions**: てか, なくちゃ, なきゃ

**Contractions are the risky class** — they overlap grammatical forms, so a bad entry can break
legitimate segmentation (e.g. a じゃん entry mangles じゃんけん; っす breaks きっすい — both rejected in
testing). Every contraction here passed an _over-firing_ check: adding it must NOT change how a
sentence tokenizes where its component parts should parse normally (少なくとも, 手か, お茶, じゃんけん…).
Test any new contraction the same way, and pin it with an over-firing regression in `corpus.spec.ts`.

## Format (IPADIC "detailed" 13-column CSV — comments NOT allowed)

```
surface, left_id, right_id, cost, POS, subcat1, subcat2, subcat3, conjForm, conjType, base, reading, pronunciation
```

The columns must match the main dictionary's `dictionary_schema`, so the positional `details` array
our tokenizer reads (`details[0]`=POS, `[6]`=base, `[7]`=reading) lines up. The simple 3-column
format does NOT align and would mis-map POS/reading — use the detailed format.

For an **i-adjective** (きもい, うざい, エモい) model the row on a real IPADIC i-adjective (高い):

```
きもい,19,19,-2000,形容詞,自立,*,*,形容詞・アウオ段,基本形,きもい,キモイ,キモイ
```

- `19,19` — the left/right context IDs IPADIC uses for 形容詞,自立 (so the lattice connects it like
  any i-adjective). A wrong id mis-connects; copy from the same word class you're modelling.
- `-2000` — word cost. More negative = more likely to win the lattice. Tuned so the slang word beats
  the shattered-fragment path without steamrolling legitimate segmentations.
- `形容詞・アウオ段,基本形` — conjugation type/form, so the word inflects (きもくない, きもかった …).

Verify every added entry with a corpus regression in `src/host/__tests__/accuracy/gold.ts` (a
sentence where it must tokenize as one word) — and confirm it doesn't mis-fire on adjacent input.
