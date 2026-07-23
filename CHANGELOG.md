# Changelog

## 0.1.0
<sub>2026-07-23</sub>

-  *(minor)*
  Initial dictionary implementation: an offline Japanese vocabulary search and word-detail view in the VSCode sidebar.

  - Search by Japanese (kanji/kana) or English, ranked exact → prefix → substring with common words first.
  - Word detail: all readings and kanji writings, senses grouped by part of speech, common badges, and cross-references.
  - Data pipeline compiles [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) into a local SQLite database served by [@tursodatabase/database](https://www.npmjs.com/package/@tursodatabase/database).
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
