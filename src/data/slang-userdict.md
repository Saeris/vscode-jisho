# Slang user dictionary (`slang-userdict.csv`)

A Lindera **user dictionary** of colloquial/slang words IPADIC lacks, layered on top of the main
IPADIC dictionary at tokenize time (spec 13 §B / spec 14). Without it, a word like きもい shatters
into き+も+い and never reaches the dictionary as one unit.

Only add words IPADIC genuinely **lacks** — most everyday slang (やばい, だるい, えぐい, きしょい …)
is already in IPADIC 4.x. Check first: tokenize the word with the base dictionary; if it comes back
as one token, don't add it. As of writing, the shortlist is きもい / うざい / エモい.

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
