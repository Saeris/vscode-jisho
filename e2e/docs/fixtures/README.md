# Screenshot fixtures

The files opened in the editor when the README's screenshots are captured. Each is chosen to model
**a task a reader might plausibly be doing**, so the feature's value is legible from the scenario
rather than only from the surrounding prose.

Keep them short. A fixture only needs enough text to fill the visible region of a cropped
screenshot, and a long file makes the capture depend on scroll position.

## The files

| File                 | Scenario                                     | Source                     |
| -------------------- | -------------------------------------------- | -------------------------- |
| `grammar-notes.md`   | Reading a grammar guide with furigana markup | Adapted — see below        |
| `checkout.ts`        | Reading a codebase with Japanese comments    | Original, written for this |
| `reading-notes.md`   | Keeping study notes in Japanese              | Original, written for this |
| `translated-docs.md` | Reading technical documentation in Japanese  | Original — see below       |
| `notes.py`           | Comment highlighting: Python, with docstring | Original, written for this |
| `notes.css`          | Comment highlighting: CSS                    | Original, written for this |
| `notes.html`         | Comment highlighting: HTML                   | Original, written for this |
| `notes.php`          | Comment highlighting: PHP                    | Original, written for this |
| `notes.rs`           | Comment highlighting: Rust                   | Original, written for this |

## Sources and licences

**`grammar-notes.md`** is adapted from [Saeris/guide-to-japanese](https://github.com/Saeris/guide-to-japanese),
a port of **Tae Kim's Guide to Learning Japanese**, used under
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The example sentences and the
explanation of を and に are from that guide; the file is trimmed and its custom markup simplified to
the `{漢字|かんじ}` ruby syntax this extension understands.

**`checkout.ts`**, **`reading-notes.md`** and the five `notes.*` files are original, written for
these screenshots. No licensing constraint.

**`translated-docs.md`** is this project's own README translated into Japanese — literally, sentence
for sentence, rather than paraphrased. That matters: a paraphrase drifts from the English it claims
to mirror, and this file is the first step toward a translated README, so any drift would have to be
undone later. It stops after the search table, which is about as much as fills the editor pane. Original in the sense that matters — it is our text, so there is no licensing constraint
— and it earns its place by being the scenario itself: a developer reading technical documentation
in a language they are still learning is exactly who this extension is for. It is also a deliberate
first step toward a translated README, which is a larger job because it needs review rather than
just writing.

**`checkout.ts`'s first line comment is deliberately top-level and unindented**, sitting outside any
string, so a hover capture can aim at a known character offset and get the dictionary's hover rather
than TypeScript's. That used to be recorded as an English comment in the file itself, which then
appeared in the code-comment screenshot — a note to a test author, shown to a reader. It lives here
instead.

The five `notes.*` files each hold the same two lines — one comment with Japanese, one string
literal with the same Japanese — so the comment/string boundary is asserted identically across every
language. They back `e2e/code-comments-languages.e2e.ts` rather than a screenshot.

## Adding a fixture

Record its source and licence here **before committing it**. If it comes from anywhere but your own
keyboard, name the project, the licence, and what was changed.

Prefer original content when a feature needs a specific construction exercised — a particular
conjugation, a name, a slang term — and no found text does it cleanly. Prefer real content when the
point is that the extension works on text people actually have.
