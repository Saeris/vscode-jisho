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

## Stroke-order drawings

**[AnimCJK](https://github.com/parsimonhi/animCJK)** — stroke-order animations, © FM&SH.

AnimCJK splits its own licensing, and this extension keeps the two sets in separate directories so each ships the terms that actually govern it:

- **Kanji** (`assets/kanji-svgs/`) — glyph paths adapt the Arphic PL KaitiM fonts and [Makemeahanzi](https://github.com/skishore/makemeahanzi), used under the [Arphic Public License](https://ftp.gnu.org/non-gnu/chinese-fonts-truetype/LICENSE). `ARPHICPL.TXT` ships unaltered alongside the data, as the licence requires.
- **Kana** (`assets/kana-svgs/`) — from AnimCJK's `svgsJaKana` set, used under the [GNU Lesser General Public License v3](https://www.gnu.org/licenses/lgpl-3.0.html) or later. `LGPL.txt` ships alongside it.

Both are file-scoped copyleft with aggregation clauses, so bundling the data into this MIT-licensed extension does not relicense the extension — only the data carries those terms.

The direction guides drawn over each stroke (numbered start markers and dashed arrows) are this project's own pedagogical additions, not modifications of the licensed glyph paths.

## Code

**[KanjiCanvas](http://github.com/asdfjkl/kanjicanvas)** — handwriting recognition.
© Dominik Klein, [MIT](https://github.com/asdfjkl/kanjicanvas/blob/master/LICENSE). This extension ships a TypeScript reimplementation of its algorithm (the Wakahara et al. stroke-correspondence method) together with its reference stroke patterns; see `src/webview/recognizer/`.

**[perfect-freehand](https://github.com/steveruizok/perfect-freehand)** — pressure-sensitive strokes for the handwriting input.
© Steve Ruiz, [MIT](https://github.com/steveruizok/perfect-freehand/blob/main/LICENSE).

**[Lindera](https://github.com/lindera/lindera)** — Japanese morphological analysis, with the IPADIC dictionary.
© the Lindera authors, [MIT](https://github.com/lindera/lindera/blob/main/LICENSE). IPADIC is © Nara Institute of Science and Technology, under a BSD-style licence.

## A note on the newspaper corpus

Word frequency comes from JMdict's `nfXX` bands, which derive from Alexandre Girardi's Mainichi Shimbun wordfreq file. It carries a newspaper's skew: 端 ("edge") outranks 箸 ("chopsticks") because edges make the news and chopsticks do not. It fixes the worst ranking cases rather than every case.
