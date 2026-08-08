<div align="center">

# 📔 Jisho — Japanese Dictionary for VSCode

[![CI status][ci_badge]][ci]

An **offline** Japanese dictionary that lives in your VSCode sidebar. Look up unfamiliar vocabulary without leaving your editor or reaching for the internet — inspired by [Shirabe Jisho][shirabe].

</div>

---

## ✨ Features

**Lookup**

- **Vocabulary search** — by Japanese (kanji or kana), Hepburn romaji, _or_ English, ranked by relevance rather than raw match tier. Conjugated input works: type 食べました and get 食べる.
- **Multi-word queries** — a sentence is tokenized into its words with parts of speech, shown as a breakdown bar you can tap to search any single word.
- **Kanji as a first-class result** — searches surface matching characters in their own section, with a full kanji page: meanings, on/kun readings, stroke count, grade, JLPT level, component breakdown, and visually-similar look-alikes.
- **Browse by category** — four sections along the bottom of the panel: Search, Vocab (JLPT level, frequency, part of speech, subject, dialect), Kanji (JLPT level, school grade, frequency), and Kana (the gojūon chart).
- **Radical picker & handwriting** — find a character you can't type, either by picking its radicals (filterable by position) or by drawing it.
- **Names** — JMnedict readings, so a name in your text resolves instead of coming back empty.

**Rich definitions**

- Every reading and kanji writing, senses grouped by part of speech, cross-references you can tap through, common/JLPT badges, and WaniKani citations.
- **Pitch accent** drawn as a contour over the reading, and **text-to-speech** for any reading.
- **Conjugation tables** for verbs and adjectives, with each form's grammar explained.
- **Example sentences** with furigana, where every word is a tap target to its own entry — a couple inline, the full pooled set on its own page.
- **Stroke order**, animated with a scrubber plus a per-stroke chart, for kanji and kana alike.
- **Copy as** — the word, its reading, romaji, or furigana as Markdown ruby or HTML.

**In-editor conveniences**

- **Hover** any Japanese word for a definition, reading and conjugation breakdown.
- **Commands** on a selection: look up, speak, add/remove furigana, add/remove spacing (分かち書き).
- **Part-of-speech highlighting** for Japanese text, driven by the same tokenizer.

**Throughout**

- **Offline** — every lookup runs against a local database. No network, no account, no context switch.
- **Theme-aware** — built on VS Code's own theme variables, so it matches whatever theme you use, including high-contrast.
- **Configurable** — text scale, hover on/off, highlighting on/off, grammar notes, stroke-guide style, and dictionary auto-update checks.

Still to come: running in web VS Code (vscode.dev). See the [roadmap](./docs/ROADMAP.md) for the full sequence and [BACKLOG.md](./docs/BACKLOG.md) for the open ideas.

## 📣 Data sources

This extension is built on the work of several open dictionary projects, whose licences require attribution. Full notices are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md); the About view inside the extension carries the same credits.

- **[JMdict / EDICT][jmdict]** and **[JMnedict][jmnedict]** — dictionary and name data, © [EDRDG][edrdg], under the [EDRDG Licence][edrdg-license].
- **[KANJIDIC2][kanjidic]** and **[KRADFILE / RADKFILE][kradfile]** — kanji data and radical decompositions, © EDRDG.
- **[JLPT vocabulary levels][tanos-jlpt]** — © [Jonathan Waller][tanos-jlpt], under [CC BY-SA 4.0][cc-by-sa].
- **[Pitch accent][kanjium]** — © Uros O., under [CC BY-SA 4.0][cc-by-sa].
- **[Kanji confusion data][yencken]** — © [Lars Yencken][yencken], under [CC BY 3.0][cc-by-3].
- **[Example sentences][tatoeba]** — from [Tatoeba][tatoeba], under [CC BY 2.0 FR][cc-by-fr].
- **[AnimCJK][animcjk]** — stroke-order drawings, © FM&SH, under the [Arphic Public License][apl] (kanji) and [LGPL v3][lgpl] (kana).
- **[KanjiCanvas][kanjicanvas]** and **[perfect-freehand][perfect-freehand]** — handwriting recognition and drawing, MIT.

## 🤝 Contributing

Building the extension, running the tests, and refreshing the dictionary data are all covered in [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports go to [GitHub Issues][issues].

## 🥂 License

Extension source released under the [MIT license][license] © [Drake Costa][personal-website]. Bundled dictionary data remains under its respective upstream licences — see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[ci_badge]: https://github.com/Saeris/vscode-jisho/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/Saeris/vscode-jisho/actions/workflows/ci.yml
[shirabe]: https://ricoapps.com/
[jmdict]: http://www.edrdg.org/jmdict/j_jmdict.html
[edrdg]: https://www.edrdg.org/
[edrdg-license]: https://www.edrdg.org/edrdg/licence.html
[kanjidic]: https://www.edrdg.org/wiki/index.php/KANJIDIC_Project
[kradfile]: https://www.edrdg.org/krad/kradinf.html
[tanos-jlpt]: https://www.tanos.co.uk/jlpt/
[kanjium]: https://github.com/mifunetoshiro/kanjium
[tatoeba]: https://tatoeba.org/
[yencken]: https://lars.yencken.org/datasets/kanji-confusion/
[cc-by-fr]: https://creativecommons.org/licenses/by/2.0/fr/deed.en
[cc-by-3]: https://creativecommons.org/licenses/by/3.0/
[jmnedict]: https://www.edrdg.org/enamdict/enamdict_doc.html
[animcjk]: https://github.com/parsimonhi/animCJK
[apl]: https://ftp.gnu.org/non-gnu/chinese-fonts-truetype/LICENSE
[lgpl]: https://www.gnu.org/licenses/lgpl-3.0.html
[kanjicanvas]: http://github.com/asdfjkl/kanjicanvas
[perfect-freehand]: https://github.com/steveruizok/perfect-freehand
[cc-by-sa]: https://creativecommons.org/licenses/by-sa/4.0/
[issues]: https://github.com/Saeris/vscode-jisho/issues
[license]: ./LICENSE.md
[personal-website]: https://saeris.gg
