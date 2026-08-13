# Changelog



## 0.1.2
<sub>2026-08-13</sub>

-  *(patch)*
  Fixes updating the dictionary on Windows, which failed with "EPERM: operation not permitted" after downloading. The extension now releases the database before swapping the new one into place.

## 0.1.1
<sub>2026-08-13</sub>

-  *(patch)*
  Fixes the first publish, which the Marketplace rejected: two of the stroke-order drawings, named after the characters they draw, collided during upload. Inside the published package they are now named by codepoint instead.

## 0.1.0
<sub>2026-08-13</sub>

-  *(minor)*
  Initial dictionary implementation: an offline Japanese vocabulary search and word-detail view in the VSCode sidebar.

  - Search by Japanese (kanji/kana) or English, ranked exact → prefix → substring with common words first.
  - Word detail: all readings and kanji writings, senses grouped by part of speech, common badges, and cross-references.
  - Data pipeline compiles [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) into a local SQLite database read through Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html).
  - React webview (React Aria + TanStack Query + XState) themed to the active VSCode color theme.
-  *(minor)*
  The full JMdict dictionary (~218k entries) is now delivered by download on first activation — sha256-verified, with progress — and search is 20-60× faster thanks to fully index-backed matching.
-  *(minor)*
  Add kanji character data (KANJIDIC2 readings, meanings, stroke counts, grades, JLPT levels) and radical decompositions (KRADFILE/RADKFILE), searchable by character or English meaning.
-  *(minor)*
  Kanji now appear as their own section in search results, open a detailed view (readings, meanings, radical components, and common words that use them), and are reachable by tapping any kanji in a word's headword.
-  *(minor)*
  Add a radical-based kanji lookup (部 button): pick component radicals grouped by stroke count to narrow down the kanji you're after — unreachable radicals grey out as you select.
-  *(minor)*
  Detail-view polish: a Home button escapes deep link-driven navigation in one step; on/kun/nanori labels carry hover tooltips explaining the jargon; and a 🔊 button reads pronunciations aloud (per-reading-category, cancellable, on kanji pages) using a natural Japanese voice where available.
-  *(minor)*
  Multi-word Japanese queries now show a part-of-speech breakdown bar (日本語を勉強します → 日本語 · を · 勉強します): tap any content word to search it. Particles are shown dimmed; English and single-word queries are unaffected.
-  *(minor)*
  Word detail now has a collapsible "Examples" section per sense, showing Japanese example sentences with their English translations (Tanaka corpus, via the Tatoeba project, CC BY 2.0 FR). Sentences come from the jmdict-examples-eng dataset, which both dictionary variants now build from.
-  *(minor)*
  Search now includes a "Names" section powered by JMnedict (~743k person, place, and organization names), with a dedicated name detail page showing type badges (surname, place, given name, company…). The names dictionary is a separate optional download fetched on demand the first time a search could return names — it's large (~130MB compressed), so it isn't bundled with the extension.
-  *(minor)*
  Kanji detail pages now animate stroke order: the character draws itself stroke by stroke, with play/pause, step-through, and replay controls (and it respects your reduced-motion setting). Each stroke shows a start-point dot and direction arrow. Stroke data is from AnimCJK (Arphic Public License).
-  *(minor)*
  You can now search by drawing a kanji: tap the ✏️ button, draw the character (stroke order and count don't matter), and pick from the recognized candidates to add it to your search. Recognition runs entirely offline — it's a functional reimplementation of the KanjiCanvas algorithm, with drawing by perfect-freehand. The recognition data (~6.7MB) loads only the first time you open the handwriting view.
-  *(minor)*
  Stroke order now has its own page, reachable from any kanji's detail view. It has a **seek slider** you can drag (or arrow through) to walk the character one stroke at a time, alongside play/pause/restart, plus a **chart** laying out every step in a grid with the newest stroke highlighted — the classic reference layout. The kanji detail page itself is leaner as a result, leading with meaning and readings.

  You can also now **copy a kanji to the clipboard** by tapping it on its detail page.
-  *(minor)*
  Search results are now ordered by how common a word actually is, so the word you meant comes first. Searching "eat" leads with 食べる instead of 食らう (a coarse "devour"); "water" leads with 水 rather than 水分 (moisture); こうえん leads with 公園 (park) rather than 講演 (lecture). Previously every exact match scored the same and the order was effectively arbitrary.
-  *(minor)*
  Kanji now have a recursive **component tree**: from a kanji's detail, tap "Component tree" to see how it breaks down into its parts, and those parts into theirs — 願 → 原 + 頁 → 貝 → 目 + 八 — with each component's meaning and readings, and every node tappable to open its own detail. This is the nested breakdown, showing intermediate components (like 原 inside 願) that the flat parts list can't. Characters that don't decompose into recognizable components keep the flat parts list.
-  *(minor)*
  The kanji stroke-order player now works properly. It no longer starts animating on its own, Play resumes from where you paused instead of jumping back to the start, and the slider both follows the animation as it draws and lets you scrub to any stroke — pausing playback when you take over. Each stroke's start point is marked with a numbered circle (①②③) and a direction arrow, shown one at a time for the stroke about to be drawn.
-  *(minor)*
  Stroke-order drawings now ship with the extension itself instead of inside the downloaded dictionary. The dictionary download shrinks by about a third (after the next dictionary release), stroke-order pages work even before the dictionary finishes downloading, and future fixes to stroke data no longer require re-downloading the dictionary.
-  *(minor)*
  On a kanji's stroke-order page you can now explore its components: hovering a region of the character highlights that component's strokes (the radical included), and clicking it jumps to that component's kanji page — or pre-selects it in the radical picker when it has no page of its own. Fully keyboard-accessible: each region is focusable and activates with Enter.
-  *(minor)*
  Word pages for verbs and adjectives now include a collapsible Conjugations table: plain and polite, affirmative and negative forms across non-past, past, te-form, potential (with the colloquial ら抜き variant), passive, causative, imperative, volitional, both conditionals, and 〜たい. Suru-nouns like 勉強 show their する-verb conjugations too. Searching for any form shown in the table finds the word again.
-  *(minor)*
  The word page's sections got a redesign from feedback: Conjugations and example sentences are now visible sections with clear headings instead of collapsed disclosures — the first two examples per sense show inline with a "Show all" link for the rest. In each conjugated form, the part that differs from the dictionary form is highlighted in color, so you can see at a glance what got added to (or replaced in) the word — forms that replace the whole word, like ある → ない, highlight entirely. On narrow sidebars the conjugation table switches to a stacked layout instead of squeezing three columns.
-  *(minor)*
  The word page now reads like a dictionary entry rather than a database dump. The headword leads with the kana reading — its pitch contour drawn above it — followed by the kanji writings in 【】brackets, with each reading showing only the writings it actually applies to. Parts of speech appear as a plain spelled-out line above the definitions they govern instead of badge pills, definitions are marked Ⓐ Ⓑ Ⓒ with their glosses flowing as sentences, and usage notes and cross-references sit inline in muted parentheses, with related words still tappable.
-  *(minor)*
  Word pages gained the rest of their dictionary anatomy: rare and search-only writings are flagged with superscript marks (喰べる探) explained in a legend, an Info section lists JLPT level and the WaniKani link, and a Kanji section shows one tappable row per character — its meanings and readings at a glance, tap to open the full kanji page.
-  *(minor)*
  First editor integrations: select Japanese (or English) text in any editor and use "Jisho: Look Up Selection" to search it in the sidebar — conjugated forms find their dictionary word — or "Jisho: Speak Selection" to hear it read aloud. Both are in the right-click menu whenever text is selected, and work even if the Jisho panel hasn't been opened yet.
-  *(minor)*
  Hover any Japanese word in a markdown or plain-text file to see its dictionary entry — reading, part of speech, and meanings — with an "Open in Jisho" link that jumps to the full page. The editor right-click items now live under a "Jisho" submenu so it's clear where they come from, and text-to-speech starts a little faster (the voice list now loads at startup instead of on your first click).
-  *(minor)*
  The dictionary hover now explains the conjugation it detected: hovering 食べたくなかった shows, under the definition, "食べたくなかった = 食べる + 〜たい (want to) + 〜ない (negation) + 〜た (past)" — so you can see what the form means in context, not just what the base word means.
-  *(minor)*
  Jisho now has settings, in VS Code's own Settings UI — open them with the ⚙ in the sidebar or "Jisho: Open Settings" from the palette. Three to start: turn the dictionary hover on or off, adjust the panel's text size to your liking, and choose the stroke-order guide style — arrows beside the stroke, or tracing its path Duolingo-style. Changes apply immediately, no reload needed.
-  *(minor)*
  New (off by default): part-of-speech coloring for Japanese text — a syntax highlighter for prose. Enable "Jisho: Highlighting" in settings and Japanese in Markdown and plain-text files colors by grammatical role using your theme's own palette: nouns, verbs, adjectives, particles, and the endings attached to verbs each read distinctly, making word boundaries visible without spaces. Works with furigana markup, and toggles live.
-  *(minor)*
  Two new editor commands automate learner word-spacing (分かち書き): "Add Word Spacing" inserts spaces at word boundaries in Japanese text — conjugated verbs stay whole, particles separate, furigana markup survives intact — and "Remove Word Spacing" restores native-style text, leaving spaces around English words alone. Both work on a selection or the whole document, from the palette or the right-click Jisho menu. Ideal for breaking down sentences for study or slide decks, then converting back.
-  *(minor)*
  Three additions for writing Japanese. On a word's page, the new ⧉ button copies it in whichever shape you need — the word, its reading, romaji, or furigana as `{食|た}べる` markdown or `<ruby>` HTML — with a preview of each before you pick. In the editor, "Jisho: Add Furigana" annotates the readings of every word in your selection (and "Remove Furigana" takes them back off), wrapping only the kanji so okurigana stays outside the brackets. And Look Up and Speak now work without selecting anything first: put the cursor in a word and they resolve it for you.
-  *(minor)*
  Hovering Japanese text now explains grammar, not just vocabulary. Hover a particle (は, を, に, で, から…) and you get what it does, when it is used, and a worked example — は versus が and に versus で cross-reference each other, since those are the two distinctions that trip everyone up. Hover a piece of a conjugated verb and the auxiliary under your cursor is explained the same way: 食べたくなかった tells you about 〜たい where you are pointing at たく, and about 〜た where you are pointing at た. The conjugation table's form labels (Te-form, Volitional, Conditional…) gained worked examples in their tooltips too. All 15 N5 particles, all 29 auxiliaries, and all 15 conjugation forms are covered, written from scratch for this extension. Turn it off with `vscode-jisho.grammar.enabled` if you only want dictionary definitions.
-  *(minor)*
  Dictionary hovers are sharper and more consistent. Hovering a word shows its part of speech as compact Japanese pills (名詞, する動詞, 一段動詞) with the English on a tooltip, and the conjugation breakdown labels each piece (〜たい, 〜ない, 〜た) with its meaning on hover. Hovering a conjugated word's ending now explains just that ending's grammar, instead of stacking it on top of the base word's definition — one hover, one thing. Grammar notes and word definitions now share the same clean layout. Hovers also survive markdown around Japanese text: a word wrapped in emphasis or bold no longer gets split, and mirrordown's escaped-pipe furigana is handled.
-  *(minor)*
  Word detail now draws on the full Tatoeba example-sentence corpus, not just the curated Tanaka subset — the fuller pool of sentences (built with furigana) will surface on a "more examples" view, sense-attributed where the source tags a sense and word-level otherwise. The accurate per-sense inline examples are unchanged.
-  *(minor)*
  Kanji detail now knows which kanji look alike — the data behind a "similar kanji" section that surfaces the ones learners actually confuse (未/末, 大/太/犬, 士/土). It uses Lars Yencken's stroke-edit and radical-distance research (CC BY 3.0) for the jōyō kanji, with a component-overlap heuristic filling in the rest.
-  *(minor)*
  The dictionary now keeps itself current: Jisho checks once a day whether a newer dictionary is available and offers to update — never forced, always a dismissible prompt, and you can turn the check off or run it any time from "Jisho: Check for Dictionary Updates". Updating downloads and verifies the new dictionary before replacing the old one, so a failed update always leaves you with a working dictionary. Superseded and half-finished downloads are cleaned up automatically so they don't pile up on disk.
-  *(minor)*
  Kanji pages now show a "Similar kanji" section — the look-alikes learners mix up (未 next to 末, 大 next to 太 and 犬), each with a one-word meaning so you can see at a glance that they look alike but mean different things. Tap any to jump to its page and compare.
-  *(minor)*
  Word pages now have a "More examples" link that opens a dedicated page of example sentences drawn from the fuller Tatoeba corpus — many more than the couple shown inline — each with furigana, grouped by meaning where the source tags one.
-  *(minor)*
  Words in example sentences are now tappable — tap any word in a "more examples" sentence to jump straight to its dictionary entry. Word boundaries and readings are computed when the dictionary is built, so the whole word (including its conjugation) is the tap target, not just part of it.
-  *(minor)*
  Example sentences on the word page now render like the "more examples" page: furigana above the kanji, and every word tappable to open its own entry. Previously they were plain text, and briefly showed the raw link markup instead.
-  *(minor)*
  Japanese in the panel is now coloured by part of speech using a purpose-built palette: nine categories instead of four, including pronouns, adnominals and interjections that previously had no colour at all. Particles are coloured too rather than dimmed to grey — they mark where words begin and end, so they earn a colour of their own.

  Colour-vision options ship alongside it. **Jisho: Appearance: Palette** offers palettes built for protanopia, deuteranopia and tritanopia — each designed from scratch for how that vision actually perceives colour, not a tinted version of the default.
-  *(minor)*
  Part-of-speech coloring in the editor now uses the same nine-color palette as the panel, including the color-vision options. It previously borrowed syntax-highlighting colors from your theme, which meant only six categories could be shown and a verb was painted like a function call.

  Kana-only words are colored now too. Interjections and adverbs written without kanji — もしもし, ゆっくり — were being skipped, which left gaps in the middle of otherwise colored sentences.
-  *(minor)*
  The search panel now remembers what you looked up. Clear the search box and your recent lookups are there to pick up again, most recent first — where there used to be only a line of instructions. Tapping one re-runs the search, and **Clear** forgets them.

  A lookup is remembered when you open a result, not as you type, so the list reads as words you looked up rather than every partial thing you typed.
-  *(minor)*
  The back and forward mouse buttons now navigate the panel, the way they do in a browser. Forward is new in both senses — the panel previously discarded a view as soon as you went back from it, so there was nothing to return to. Now a mis-click is undoable.
-  *(minor)*
  Grammar and usage tags on the word page are now compact colour-coded pills instead of a paragraph of prose. それぞれ used to open with "adverb (fukushi), noun (common) (futsuumeishi), nouns which may take the genitive case particle 'no', word usually written using kana alone" above a one-line definition; it now reads の adjective · adverb · noun · kana, each carrying its part-of-speech colour and its full description on hover.

  Prefer the Japanese grammatical terms? Set `Jisho › Appearance: Tag Labels` to `japanese` and the same row reads の形容詞 · 副詞 · 名詞 · 「kana」. The full description stays on hover either way.
-  *(minor)*
  Words in example sentences now carry their part-of-speech colour — the same hue that word wears in the search breakdown, in the grammar pills and in the editor — so an example reads as structure, not just as a string. Particles and auxiliaries are coloured too, and stay non-tappable: seeing は delimited is useful, opening a dictionary entry for it is not.

  Pronouns (彼, 私, あなた) and pre-noun adjectivals (この, 大きな) are now tappable as well, so you can look them up like any other word.

  Turn it off with `Jisho › Appearance: Color Examples`. That setting covers the Jisho panel only; `Jisho › Highlighting: Enabled` remains the separate opt-in for colouring Japanese in your own Markdown and plain-text files.
-  *(minor)*
  Browse the dictionary by category, not only by search box. The empty search view now offers **Browse by category**: JLPT levels, frequency bands, parts of speech, usage and register, subject fields, and regional dialects.

  Each list opens ordered by frequency — the words you will actually meet first — and switches to あ–ん order with a kana jump rail down the side, so a long list works as an index as well as a study order.
-  *(minor)*
  Filter searches by category with `#tags`. Type `#` in the search box and it suggests the vocabulary — `#jlpt-n5`, `#verb-godan`, `#kansai`, `#computing` — completing into a chip you can delete in one keystroke.

  A tag on its own opens that category's word list, so `#jlpt-n5` + Enter is a shortcut for browsing to it. Combined with text it narrows the results instead: `#jlpt-n5 taberu` searches only N5 words.
-  *(minor)*
  Grammar tags on a word page are now tappable: tapping "ichidan verb" on 食べる opens every ichidan verb, tapping "Kansai-ben" opens the dialect. Tags the browse tree does not carry stay as plain labels, so a tappable tag always leads somewhere.

  New `#kanji`, `#name` and `#place` filters pick what KIND of result you want — a character with a given meaning rather than a word containing it, or a place rather than a person. `#name` and `#place` appear only once the names dictionary is downloaded.
-  *(minor)*
  The dictionary now runs on Node's built-in SQLite instead of a bundled native database engine.

  Browsing a large category was the thing that forced this: ordering "Nouns" by kana never finished, because the old engine's planner scanned all 218,290 words instead of using the tag index it had. The same queries now return in about 240ms, and the rest of the app got faster with them.

  Two other things follow from it. **Intel Macs and Windows on ARM are supported again** — the old engine shipped no binary for either, which is the only reason they were dropped — and every download is ~13MB smaller, since the database no longer needs a native package at all.

  Also fixed: a failed dictionary open (a version-mismatched or corrupt file) left its file handle open, which on Windows could block replacing the very file the extension was about to re-download.
-  *(minor)*
  Japanese text now wraps where a reader would break it. A sentence too long for the sidebar used to split between any two characters, stranding a particle at the start of a line; it now breaks at phrase boundaries, so 図書館に行って／精白米を食べました rather than 図書館に行って精白米／を食べました. Definitions and other English prose gained a little more space between lines, and no longer end on a single stranded word.

  Smaller things that come with it: lines can no longer begin with small kana (っ ゃ ゅ ょ) or a long-vowel mark, parenthesised notes lose the stray indent before their opening bracket, and long romaji readings wrap instead of forcing the panel sideways.

  This raises the minimum VS Code version to 1.123. The typography above is built on CSS that older versions cannot render, and the extension was already being tested against a much newer build than it claimed to support.
-  *(minor)*
  Tapping a word in the breakdown bar now filters the results instead of starting a new search. Search 図書館に行きました and the sentence stays in the box: tap 図書館 to see just that word's entries, tap 行く to switch to those, tap it again to see everything. Previously the first tap replaced your sentence with that one word, and the other words were gone with it.

  The filter survives opening a result and pressing Back, and the chips are one keyboard group — arrow between them, space to toggle.

  Also fixes a separate bug: reopening the sidebar while browsing a category dropped you back at an empty search instead of the list you were on.
-  *(minor)*
  Searching a whole sentence now says so. Look up 毎日日本語を勉強します and the results appear under a "Partial matches" heading, because that is what they are — the individual words the sentence is made of, not matches for the sentence itself. If the thing you typed is also a dictionary entry in its own right, it appears above that list, set apart, as the direct answer.

  Ordinary single-word lookups are unchanged: no heading, just the ranked results with the best match first.
-  *(minor)*
  The panel now has four sections along the bottom — Search, Vocab, Kanji and Kana — instead of hiding browsing behind a link on the empty search screen. Each remembers where you were: type a query, switch to Vocab, come back, and your search is still there. Opening a word or kanji hides the sections until you return.

  Kanji and Kana are placeholders for now; their contents land next.

  The "Browse by category" link is gone from the empty search view — the Vocab section is the same destination and is always one tap away.
-  *(minor)*
  The Kanji section now browses characters by JLPT level (N5–N1), school grade, and frequency. Each list is a grid of characters with their meanings; tap one to open its page.

  The JLPT lists use the modern N5–N1 scale rather than the pre-2010 four-level one the kanji data ships with, so they match what current study resources show. Counts are per level rather than running totals, and 172 jōyō kanji — 分, 的, and most prefecture names — carry no level at all; the list says so.
-  *(minor)*
  The Kana section now shows the full gojūon chart — the 46 base kana, the voiced and semi-voiced rows, and the digraphs — with romaji under each one. One toggle switches the whole chart between hiragana and katakana.

  Tapping a kana opens its stroke order, the same animated player and step-by-step chart the kanji pages use. Digraphs like きゃ have no drawing of their own, so they sit inert rather than leading to an empty page.

  The chart keeps its gaps rather than closing them up: や has no yi or ye, わ no wu, so those cells stay empty and every column reads as one vowel top to bottom. ゐ and ゑ are shown but dimmed — you will not meet them outside historical text, and they are there for when you do.
-  *(minor)*
  Reporting a problem no longer means assembling your setup by hand. **Jisho: Report an Issue** opens a GitHub issue with your versions, dictionary details and changed settings already filled in, and if the panel ever crashes, the error screen offers to do the same with the error attached. The About view has a **Copy diagnostics** button for the same information, if you would rather paste it somewhere else. Nothing is sent anywhere until you choose to file the report, and file paths are stripped from crash details before they leave your machine.
-  *(patch)* - Support searching by Hepburn romaji (e.g. "taberu" finds 食べる), derived from each reading at build time via wanakana.
-  *(patch)*
  Refresh the cached database when a newer build is available (fixes stale search results, including missing romaji), and stack search results so they stay readable in a narrow sidebar.
-  *(patch)*
  Rank search results by relevance: whole-word gloss matches, the word's primary surface, and closer/shorter terms now outrank substring noise — "study" surfaces 勉強, "water" surfaces 水, "eat" surfaces eat-verbs.
-  *(patch)* - Going back from a word detail restores your search query and results instead of an empty view.
-  *(patch)*
  Conjugated input now finds dictionary forms: はなします (or "hanashimasu") matches 話す, 食べた matches 食べる, たかくない matches 高い — covering polite, te/past, negative, potential/passive/causative, volitional, conditional, desiderative, progressive, and い-adjective inflections.
-  *(patch)*
  Cross-references in word details are now tappable — clicking a "See also" or "Antonym" term jumps to search results for it, styled as links so interactivity is visible.
-  *(patch)*
  New ⓘ About view showing dictionary provenance (variant, entry count, JMdict date) and the attribution the EDRDG license requires.
-  *(patch)*
  The extension now ships as per-platform packages (Windows x64, macOS Apple Silicon, Linux x64/arm64), each carrying only its own native SQLite binary. Intel Macs are unsupported until turso ships a darwin-x64 build.
-  *(patch)*
  Navigating into a word detail and back now preserves the search view's scroll position and list state (the search view stays mounted via React's Activity API).
-  *(patch)* - Pronunciation now picks a clearer Japanese voice instead of whatever the OS lists first.
-  *(patch)*
  Conjugated Japanese searches now resolve via the morphological tokenizer's dictionary form (more accurate than the rule-based fallback), so more inflected queries find their word.
-  *(patch)*
  Press ↓ from the search box to move into the results list (and ↑ at the top, or Esc, to return to the box) — no more tabbing past the toolbar buttons.
-  *(patch)*
  The part-of-speech breakdown bar no longer appears for all-kana queries (にほんごをはなしますか), which the tokenizer can't segment reliably without kanji boundaries — those now search directly. Mixed-script queries with kanji (日本語を話しますか) still show the breakdown.
-  *(patch)*
  Word results and word detail now show a JLPT level badge (N5–N1) where a level is known. Levels are an unofficial community estimate (Jonathan Waller / tanos.co.uk, via yomitan-jlpt-vocab, CC BY-SA 4.0) — the badge's tooltip says so. No official JLPT vocabulary list exists.
-  *(patch)*
  Word detail now shows pitch accent notation next to each reading (e.g. たべる [2]) — the mora position of the downstep, 0 meaning flat. Data from Kanjium (Uros O., NHK/Wadoku), CC BY-SA 4.0. Words with multiple readings show each reading's own pattern.
-  *(patch)*
  Pitch accent is now drawn as a graphical contour over each reading — an overline across the high-pitch moras with the downstep marked — instead of a bare number (the number moves to the tooltip). This matches the standard OJAD/dictionary notation and is far easier to read at a glance.
-  *(patch)*
  Word and kanji detail pages now have a small "WK" link that opens a WaniKani search for that term in your browser — handy if you study kanji there. No WaniKani content is bundled; it's a citation link only.
-  *(patch)*
  Fixed the pitch-accent contour, which rendered as disconnected fragments with a stray vertical tick instead of a readable pitch line. It's now drawn as one continuous line above the reading — riding high over high-pitch moras, low over low ones, with a clear downstep where the pitch falls. Words with an accent on their final mora (odaka, e.g. 男 おとこ) show a short trailing fall, so they're no longer indistinguishable from flat (heiban) words.
-  *(patch)*
  Fixed the kanji parts list, where tapping certain components (ノ ハ マ ユ ヨ ｜) led to a "Kanji not found" dead end. These are stroke shapes rather than characters — real building blocks (ノ appears in 1,415 kanji) that simply have no dictionary entry of their own. Tapping one now opens the radical lookup showing every kanji built from that part, which is what you were asking for anyway. The section is also now called "Parts" rather than "Components", matching what the data actually describes.
-  *(patch)*
  Text throughout the panel is slightly larger — kanji need more pixels than latin text to stay legible, and the old size matched VS Code's chrome exactly. A user-adjustable text-size setting is planned. The conjugation table's form names now explain themselves: hover (or focus) a label like "Te-form" for a short note on when that form is used.
-  *(patch)*
  Conjugation-suffix highlighting is now legible on light themes: the accent color mixes toward your theme's own text color, so it darkens on light themes and lightens on dark ones instead of washing out.
-  *(patch)*
  Accent colors are now computed in the OKLCH color space: the conjugation-suffix highlight takes its lightness directly from your theme's text color (so it is exactly as readable as body text, in any theme) and all color blending — stroke highlights, chart emphasis — interpolates perceptually instead of through sRGB, which was muddying tones.
-  *(patch)*
  The dictionary hover now understands furigana markup and conjugations: hovering anywhere in {食|た}べたくなかった — braces, reading, or any conjugated fragment — resolves the whole word and shows 食べる's entry, with the highlight covering the complete form. Previously the markup split words apart and hovering a suffix described the suffix instead of the word.
-  *(patch)*
  Handwriting recognition is substantially faster — up to 1.75× on complex characters, with the slowest moment (finishing a many-stroke kanji) dropping from about 22ms to 13ms. Drawing should feel more responsive throughout, particularly on the last strokes of characters like 議 or 識, where the candidate search does the most work. Recognition results are unchanged.
-  *(patch)*
  The dictionary download is now zstd-compressed instead of gzip, shrinking each artifact by ~29% (the full dictionary drops from ~135MB to ~96MB) so first-run provisioning transfers less and decompresses faster.
-  *(patch)*
  The "words containing this kanji" list on a kanji's page now leads with the words you're most likely to want. It used to order common words arbitrarily, so a rare compound could sit at the top; now 水 shows 水・水準・水道 first (not 水俣病), and 生 shows 学生・生活・人生 first.
-  *(patch)*
  Hovering Japanese words in the editor now resolves them more accurately. Previously a word could match an unrelated same-sounding entry — hovering the し of してください showed 死 ("death") or 擦る ("to rub") instead of する ("to do"). The hover now uses the part of speech the tokenizer already knows, so it lands on the right entry.
-  *(patch)*
  Searching a conjugated word now surfaces the right verb. Previously typing an inflected form could bury the intended word under grammatically-impossible matches — searching して (the te-form of する) returned 仕手 / 知る / 汁 above 為る. Deinflection now checks that each candidate's part of speech actually fits the conjugation, so the noise is gone. Conjugated する-verbs (勉強した → 勉強) and kanji-written 来る (来た → 来る) resolve correctly too.
-  *(patch)*
  Hovering a word written with a kanji that several different words share now shows the right one. A single kanji like 本 can be written for both 本 (ほん, "book") and 元 (もと) — previously the hover could pick the more common writing regardless of how the word was actually read, so 本 sometimes showed 元, 風 showed 振り, and 息 showed 息子. The hover now uses the reading to resolve the word, so the entry it shows matches the word in the sentence. A new hand-judged accuracy corpus guards this and the earlier conjugation fixes against regressions.
-  *(patch)*
  Words normally written in kana now show their kana form in the hover and search results, instead of a rarely-used kanji spelling. Hovering ここ, ちょっと, ありがとう, or する used to head the tooltip with 此処 / 一寸 / 有難う / 為る — spellings almost no one writes — which was more confusing than helpful. These now read as the kana. Words that happen to be tagged usually-kana but are still commonly written in kanji (美味しい, 犬, 来る) keep their kanji heading.
-  *(patch)*
  Hovering a common verb like なる now shows the everyday word (成る "to become") instead of a rare homophone (生る "to bear fruit"). When two words share a reading and nothing else tells them apart, the dictionary used to pick by newspaper frequency — which is measured on the kanji character, not the word, so a rare word written with a common character could win. It now prefers the word with more dictionary senses, which is reliably the one people actually mean.
-  *(patch)*
  Hovering a polite word like お電話 or ご案内 now finds its definition. The tokenizer glues the honorific お/ご onto the word, and the combined form isn't a dictionary entry, so the hover previously came up empty. It now retries without the prefix when the plain word is a real entry — お電話 → 電話, ご案内 → 案内 — while leaving words where the prefix is part of the word itself (お茶, ご飯, お名前) untouched.
-  *(patch)*
  The Japanese tokenizer now runs on Lindera's native Node binding instead of the WebAssembly build. Tokenization is unchanged — the same word segmentation and readings — but this moves to the current Lindera release (the WASM package was stuck several versions behind) and opens the door to custom dictionary entries for slang and colloquial words that the standard dictionary misses. The compiled dictionary now ships alongside the extension rather than embedded in the tokenizer.
-  *(patch)*
  Slang the standard dictionary doesn't know — きもい, うざい, エモい — now works. Previously the tokenizer broke these into meaningless fragments (き・も・い), so hovering or highlighting them found nothing. A small curated dictionary of colloquial words now teaches them to the tokenizer as proper adjectives, and it can grow as more are added.
-  *(patch)*
  The slang dictionary grew from a 3-word proof of concept to ~22 curated colloquial words the standard dictionary misses — i-adjectives (きもい, エモい, グロい …), modern nouns (ワンチャン, コスパ, リア充, 陰キャ, ぼっち …), and common contractions (てか, なきゃ …). Each was verified to be a genuine gap and tested so it doesn't disturb how ordinary sentences are read.
-  *(patch)*
  Fixed stroke-order drawings showing the wrong character on macOS. A few dozen kanji have a second, legacy codepoint that means the same character, and each shipped its own drawing — but macOS treats the two as the same filename, so one silently replaced the other and those kanji drew the wrong glyph. Only one drawing per character now ships, and the legacy codepoint resolves to it.
-  *(patch)*
  Packaging now refuses to build an extension whose tokenizer dictionary is missing, instead of quietly producing one that cannot segment Japanese at all — no hovers, no word spacing, no furigana, no search breakdown.
-  *(patch)*
  Search and editor hovers are noticeably quicker — a full page of results resolves about 3× faster, and the hover's word lookup around 8×. Nothing about the results themselves changed; the dictionary was just repeating work it could reuse.
-  *(patch)*
  Dictionary hovers in the editor are dramatically faster — the lookup behind them went from roughly a third of a second to well under a millisecond, so a hover now appears immediately instead of lagging behind the cursor. Name search is about twice as fast too. Results are unchanged.
-  *(patch)*
  The dictionary download is about 10% smaller. Example sentences no longer store the same Japanese text twice — once plain and once with furigana — since the plain form can be derived from the annotated one.
-  *(patch)*
  The sidebar no longer forgets where you were. Previously, collapsing the Jisho panel or switching to another activity-bar icon and coming back dropped you at an empty search box — the word you were reading and the text you had typed were both gone. Both now survive.
-  *(patch)*
  "Remove furigana" now leaves markdown formatting untouched. It previously stripped emphasis markers (`*`, `**`, `_`, `` ` ``, `==`, `~~`) along with the ruby, so running it on `これは**重要**です` returned `これは重要です`.
-  *(patch)*
  "Add furigana" and "Add spacing" now handle text with markdown formatting correctly. Kanji wrapped in `*emphasis*` or `**bold**` previously got no furigana at all, and spacing landed inside the markers (`私 は** 本** を 読む`).
-  *(patch)*
  The "more examples" link now appears only when there are examples worth a page, and says how many ("20 more examples"). It used to show on every word: nearly half the dictionary has no pooled sentences, so the link often led to a blank page.

  The "common" marker is now a pill alongside the grammar tags rather than a differently-styled badge above them, and the tag row has a little more room above the definition it annotates.
-  *(patch)*
  Stroke-order numbers are legible again. The direction arrow was drawn over the numbered start marker, so the number you need in order to know where a stroke begins was struck through by the arrow leaving it. The number now draws on top, and it renders the way it was designed to — a green ring around the numeral rather than a green numeral, so it stays readable over the black strokes underneath.

  Conjugation suffixes are now clearly colored on light themes. The accent took its lightness from the theme's own text color, which works on a dark background but on a light one produced a dark brown almost indistinguishable from the surrounding text — so the suffix that was supposed to stand out just looked like more text. Light themes now get their own value, and the ending reads as distinctly as it already did in dark themes.
-  *(patch)*
  Tooltips on the interactive tags now match the editor instead of the operating system. Tapping "ichidan verb" on a word page opens that category, and the tooltip explaining what the tag means — and that tapping it goes somewhere — now appears promptly, styled like VS Code's own hovers, and reachable from the keyboard rather than the mouse alone.

  Badges and non-tappable tags keep the browser's plain tooltip on purpose. They are labels rather than controls, and the themed version would have to announce them to a screen reader as buttons that do nothing, and add each of them to the tab order.
-  *(patch)*
  Long browse lists — tapping a category like "N5 vocabulary", which can be two thousand words — no longer stutter when the panel is resized or the list is re-sorted. The list only lays out the rows near the viewport instead of all of them at once, which takes that work from about 36ms to 6ms. The same words in the same order; they just arrive without the hitch.
-  *(patch)*
  With part-of-speech highlighting turned on, typing Japanese prose now recolours once you pause rather than trying to keep up with every keystroke. Colouring a screenful of dense text is a tokenizer pass per visible line, and doing it mid-word was work spent on text you were still in the middle of writing. Scrolling and switching editors still repaint immediately — there the delay would be visible as uncoloured text you are already looking at.
-  *(patch)*
  Searching a word made of several kanji (図書館) no longer asks the database whether each character exists before looking it up — hydrating the rows already answers that. It saves a round trip per character, and the Kanji section shows exactly the same characters in the same order.
-  *(patch)*
  The handwriting recognizer starts up faster — the reference patterns it loads on your first stroke now decode in about a quarter of the time (10.7ms to 2.8ms), so the first character you draw gets its candidates back sooner. The patterns themselves are unchanged, down to the byte.
-  *(patch)*
  The extension now states the VS Code version it actually needs. Nothing changes in the UI; installing on an older VS Code fails cleanly up front instead of erroring somewhere in the middle of a lookup.
-  *(patch)*
  Browsing now shows a breadcrumb trail — `Vocab › JLPT level › N5` — on every level, in place of the `← Back` link and the separate title row. The trail names the page you are on and carries the word count on the same line. Every step above is tappable and goes exactly where it says: the first one returns to the top of the section, not one level up.

  The header is now the same height at every level, so drilling into a category no longer shifts the list under your cursor.

  The trail's first step names the section you came from. Reaching a list another way — a `#tag`, or a grammar pill on a word page — shows a home control instead, since there is no section you drilled through.

  Fixes stray numbering that appeared over the trail (". Browse2. Subject").
-  *(patch)*
  The `#tag` suggestion menu now sizes itself to its entries instead of being pinned to the width of the search box, so entries like "Godan verbs" and "Yojijukugo (four-character)" stay on one line in a narrow panel rather than wrapping mid-word.
-  *(patch)*
  The Common words categories work again. Every ranked word was landing in "1 – 2,000" — 15,147 of them — leaving the other seven categories empty.

  There are now twelve categories rather than eight, running to 24,000. The old range stopped at 16,000 and left the words below it with nowhere to browse them.
-  *(patch)*
  The search box now stays one line high. A sentence-length query used to wrap and grow the field to three lines, pushing the toolbar and every result down the panel as you typed. Long queries now scroll inside the box instead, and the caret stays in view whichever way you move it.
-  *(patch)*
  The panel no longer shows two scrollbars side by side. VS Code draws its own at the panel's edge and the panel was drawing the browser's default immediately inside it — most obvious at larger text sizes, but present at the default size too. The panel's scrollbar now matches VS Code's own, so the pair reads as one.
-  *(patch)*
  Fixed the second scrollbar that appeared down the side of a word page. The conjugation table's hidden header row was escaping the panel and stretching the page 12 pixels past its own height, so the panel scrolled as well as its contents.
-  *(patch)*
  The stroke-order seek handle now sits centred on its track. It was riding above it, with the bottom edge of the circle crossing the middle of the rail.
-  *(patch)*
  Radical lookup results now show each kanji's meaning under the character, instead of a grid of bare glyphs you had to open one at a time to identify. The matches also spread evenly across the panel rather than packing to the left.
-  *(patch)*
  Handwriting candidates now show each kanji's meaning under the character, the same way the radical lookup and the kanji page's "Similar kanji" list do. Both lists also lay out on a grid, so a short final row lines up with the rows above it instead of scattering across the panel.
-  *(patch)*
  Japanese example sentences no longer wrap their closing 。 onto a line of its own. A sentence that overflows the sidebar now balances its final line instead of leaving a lone terminator dangling under a full-width line.
-  *(patch)*
  The extension now has an icon, and its Marketplace page is a full user manual: a walkthrough of your first lookup, then a section per feature with screenshots — searching, reading a word, kanji and stroke order, the radical picker and handwriting, browsing, and the editor features. Commands and settings are listed in full, with troubleshooting and an FAQ.
-  *(patch)*
  The sidebar panel header now reads "Jisho" rather than "Jisho: Dictionary", and the extension is listed as "Jisho: Offline Japanese Dictionary" so it is distinguishable from other Jisho extensions on the Marketplace.
-  *(patch)*
  When something fails to load, the error now comes with a **Report this problem** link instead of leaving you with a message and nowhere to go. The same applies if the extension fails to start, which previously showed VS Code's generic "cannot activate" notice with nothing to click.
-  *(patch)*
  The Vocab tab keeps its section tabs while you are looking at a word list, so browsing no longer loses the bar partway through. Kanji and Kana browse already behaved this way.
