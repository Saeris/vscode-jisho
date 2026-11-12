# Third-party notices

This extension is built on the work of several open dictionary and data projects. Their licences require attribution, which is reproduced here in full. A summary appears in [README.md](./README.md), and the About view inside the extension carries the same credits.

The extension's own source is [MIT](./LICENSE.md). The data below remains under its respective upstream licences; bundling it does not relicense the extension, and none of these licences extends to your own work.

## Dictionary data

**[JMdict / EDICT](http://www.edrdg.org/jmdict/j_jmdict.html)** — Japanese–English dictionary data.
© the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/) (EDRDG), used under the [EDRDG Licence](https://www.edrdg.org/edrdg/licence.html). Sourced through [jmdict-simplified](https://github.com/scriptin/jmdict-simplified).

**[JMnedict](https://www.edrdg.org/enamdict/enamdict_doc.html)** — the names dictionary, an optional download.
© EDRDG, used under the [EDRDG Licence](https://www.edrdg.org/edrdg/licence.html).

**[KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)** — kanji readings, meanings, stroke counts, grades and JLPT levels.
© EDRDG, used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

**[KRADFILE / RADKFILE](https://www.edrdg.org/krad/kradinf.html)** — kanji radical and component decompositions.
© EDRDG; RADKFILE2 and KRADFILE2 © Jim Rose. Used under the [EDRDG Licence](https://www.edrdg.org/edrdg/licence.html).

## Study and reference data

**[JLPT vocabulary levels](https://www.tanos.co.uk/jlpt/)** — word-level JLPT tags.
© [Jonathan Waller](https://www.tanos.co.uk/jlpt/), used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) through [yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab). No official JLPT vocabulary list has been published since 2010, so these levels are an unofficial community estimate.

**[JLPT kanji levels](https://github.com/onlyskin/kanjiapi)** — kanji-level N5–N1 tags.
© the kanjiapi contributors, used under the [MIT licence](https://github.com/onlyskin/kanjiapi/blob/master/LICENSE). Kanjidic2's own `jlpt` field is the pre-2010 four-level scale and does not convert to the modern one, so this is a separate source. Counts are per level rather than cumulative.

**[Pitch accent](https://github.com/mifunetoshiro/kanjium)** — mora-position pitch accent notation.
© Uros O. ([Kanjium](https://github.com/mifunetoshiro/kanjium), derived from NHK and Wadoku data), used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

**[Kanji confusion data](https://lars.yencken.org/datasets/kanji-confusion/)** — visually similar kanji.
© [Lars Yencken](https://lars.yencken.org/), used under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Stroke-edit and Yeh-Li radical distance over the jōyō kanji, from his PhD research. A component-overlap heuristic fills in non-jōyō characters; that part is a deterministic approximation rather than curated confusable pairs.

**[Example sentences](https://tatoeba.org/)** — from the Tatoeba project.
Used under [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/deed.en). The curated Tanaka-corpus subset, embedded in JMdict through jmdict-simplified, provides the per-sense inline examples; the fuller Tatoeba corpus provides the word-level example pool.

## Regional forms

Which form of a character China, Hong Kong, Taiwan and Japan each write, whether two regions draw it the same way, and each form's list level and stroke count. These tables are built when the dictionary is built; none of the source files below ships with the extension.

**[OpenCC](https://github.com/BYVoid/OpenCC)** — variant tables relating simplified, traditional, Hong Kong, Taiwan and Japanese forms.
© Carbo Kuo and the OpenCC contributors, used under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

**[Source Han Sans](https://github.com/adobe-fonts/source-han-sans) and [Source Han Serif](https://github.com/adobe-fonts/source-han-serif)** — their per-region character maps, which tell whether two regions draw a character with the same glyph.
© Adobe, used under the [SIL Open Font License 1.1](https://openfontlicense.org/). Source is a trademark of Adobe in the United States and/or other countries.

**[Unihan database](https://www.unicode.org/charts/unihan.html)** — China's 2013 table of general standard characters, Hong Kong's list of graphemes, the jōyō kanji list, stroke counts, and the Mandarin and Cantonese readings.
© Unicode, Inc., used under the [Unicode License v3](https://www.unicode.org/license.txt).

**[CNS 11643](https://www.cns11643.gov.tw/)** — Taiwan's lists of common and less-common characters, and Taiwan's official stroke counts.
CNS 11643 Chinese Standard Interchange Code, National Development Council, Taiwan, used under the [Open Government Data License, version 1.0](https://data.gov.tw/license).

The frequency ranks come from a different corpus in each region, and the view names each one:

**[Modern Chinese Character Frequency List](https://lingua.mtsu.edu/chinese-computing/statistics/)** — China's ranks.
© 1998-2026 Jun Da, Middle Tennessee State University. The list states no licence; it is used here with credit. It reaches us through [hanziDB.csv](https://github.com/ruddfawcett/hanziDB.csv), © 2017 Rudd Fawcett, [MIT](https://github.com/ruddfawcett/hanziDB.csv/blob/master/LICENSE).

**[words.hk character counts](https://words.hk/faiman/analysis/)** — Hong Kong's ranks.
Public domain. Credit to words.hk, as it asks.

**[Corpus character frequency, 2023](https://teric.naer.edu.tw/wSite/ct?ctNode=645&mp=teric_b&xItem=2068770)** — Taiwan's ranks.
National Academy for Educational Research, Taiwan, used under its website data open declaration, which allows reuse with the source credited.

**[kanji-frequency](https://github.com/scriptin/kanji-frequency)** — Japan's ranks, counted on Japanese Wikipedia.
© scriptin, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The notes on how the forms relate and where a shape came from are quoted from Wiktionary:

**[English Wiktionary](https://en.wiktionary.org/)** — the Translingual and Chinese sections of each character's page.
Text by the Wiktionary contributors, used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The view shows each note with a link to the page it is quoted from. Pronunciation tables that the extraction left in a note are removed; the text is otherwise unchanged. Extracted with [Wiktextract](https://github.com/tatuylonen/wiktextract) through [kaikki.org](https://kaikki.org/), which asks to be cited as: Tatu Ylonen, "Wiktextract: Wiktionary as Machine-Readable Structured Data", Proceedings of the 13th Conference on Language Resources and Evaluation (LREC), pp. 1317–1325, Marseille, 20–25 June 2022.

## Stroke-order drawings

**[AnimCJK](https://github.com/parsimonhi/animCJK)** — stroke-order animations, © FM&SH.

AnimCJK splits its own licensing, and this extension keeps the two sets in separate directories so each ships the terms that actually govern it:

- **Kanji** (`assets/kanji-svgs/`) — glyph paths adapt the Arphic PL KaitiM fonts and [Makemeahanzi](https://github.com/skishore/makemeahanzi), used under the [Arphic Public License](https://ftp.gnu.org/non-gnu/chinese-fonts-truetype/LICENSE). `ARPHICPL.TXT` ships unaltered alongside the data, as the licence requires.
- **Chinese** (`assets/hans-svgs/`, `assets/hant-svgs/`) — China's and Taiwan's stroke order for the jōyō kanji they write differently, from AnimCJK's Simplified and Traditional Chinese sets, under the same [Arphic Public License](https://ftp.gnu.org/non-gnu/chinese-fonts-truetype/LICENSE). `ARPHICPL.TXT` ships unaltered in each directory.
- **Kana** (`assets/kana-svgs/`) — from AnimCJK's `svgsJaKana` set, used under the [GNU Lesser General Public License v3](https://www.gnu.org/licenses/lgpl-3.0.html) or later. `LGPL.txt` ships alongside it.

Both are file-scoped copyleft with aggregation clauses, so bundling the data into this MIT-licensed extension does not relicense the extension — only the data carries those terms.

The direction guides drawn over each stroke (numbered start markers and dashed arrows) are this project's own pedagogical additions, not modifications of the licensed glyph paths.

## Fonts

**[Noto Sans CJK](https://github.com/notofonts/noto-cjk)** — the region fonts that draw how China, Hong Kong, Taiwan and Japan each write a character.
© 2014-2021 Adobe, used under the [SIL Open Font License 1.1](#sil-open-font-license-11), reproduced in full below. The extension ships subsets of the SC, HK, TC and JP versions, renamed "Jisho Sans SC", "Jisho Sans HK", "Jisho Sans TC" and "Jisho Sans JP" because a modified version should not present itself as the original. Each file keeps the font's copyright and licence records. Noto is a trademark of Google LLC.

## Code

**[KanjiCanvas](http://github.com/asdfjkl/kanjicanvas)** — handwriting recognition.
© Dominik Klein, [MIT](https://github.com/asdfjkl/kanjicanvas/blob/master/LICENSE). This extension ships a TypeScript reimplementation of its algorithm (the Wakahara et al. stroke-correspondence method) together with its reference stroke patterns; see `src/webview/recognizer/`.

**[perfect-freehand](https://github.com/steveruizok/perfect-freehand)** — pressure-sensitive strokes for the handwriting input.
© Steve Ruiz, [MIT](https://github.com/steveruizok/perfect-freehand/blob/main/LICENSE).

**[hanji](https://github.com/sxzz/hanji)** — the method for grouping a character's regional forms and comparing their glyphs, adapted in `scripts/regional.ts`.
© Kevin Deng, [MIT](https://github.com/sxzz/hanji/blob/main/LICENSE).

**[Lindera](https://github.com/lindera/lindera)** — Japanese morphological analysis, with the IPADIC dictionary.
© the Lindera authors, [MIT](https://github.com/lindera/lindera/blob/main/LICENSE). IPADIC is © Nara Institute of Science and Technology, under a BSD-style licence.

## A note on the newspaper corpus

Word frequency comes from JMdict's `nfXX` bands, which derive from Alexandre Girardi's Mainichi Shimbun wordfreq file. It carries a newspaper's skew: 端 ("edge") outranks 箸 ("chopsticks") because edges make the news and chopsticks do not. It fixes the worst ranking cases rather than every case.

## SIL Open Font License 1.1

The licence of the region fonts (see Fonts), as published with Noto Sans CJK.

```text
This Font Software is licensed under the SIL Open Font License,
Version 1.1.

This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font
creation efforts of academic and linguistic communities, and to
provide a free and open framework in which fonts may be shared and
improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software
components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to,
deleting, or substituting -- in part or in whole -- any of the
components of the Original Version, by changing formats or by porting
the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed,
modify, redistribute, and sell modified and unmodified copies of the
Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created using
the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
