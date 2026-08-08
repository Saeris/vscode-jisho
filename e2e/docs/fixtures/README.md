# Screenshot fixtures

The files opened in the editor when the README's screenshots are captured. Each is chosen to model
**a task a reader might plausibly be doing**, so the feature's value is legible from the scenario
rather than only from the surrounding prose.

Keep them short. A fixture only needs enough text to fill the visible region of a cropped
screenshot, and a long file makes the capture depend on scroll position.

## The files

| File               | Scenario                                     | Source                     |
| ------------------ | -------------------------------------------- | -------------------------- |
| `grammar-notes.md` | Reading a grammar guide with furigana markup | Adapted — see below        |
| `checkout.ts`      | Reading a codebase with Japanese comments    | Original, written for this |
| `reading-notes.md` | Keeping study notes in Japanese              | Original, written for this |

## Sources and licences

**`grammar-notes.md`** is adapted from [Saeris/guide-to-japanese](https://github.com/Saeris/guide-to-japanese),
a port of **Tae Kim's Guide to Learning Japanese**, used under
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The example sentences and the
explanation of を and に are from that guide; the file is trimmed and its custom markup simplified to
the `{漢字|かんじ}` ruby syntax this extension understands.

**`checkout.ts`** and **`reading-notes.md`** are original, written for these screenshots. No
licensing constraint.

## Adding a fixture

Record its source and licence here **before committing it**. If it comes from anywhere but your own
keyboard, name the project, the licence, and what was changed.

Prefer original content when a feature needs a specific construction exercised — a particular
conjugation, a name, a slang term — and no found text does it cleanly. Prefer real content when the
point is that the extension works on text people actually have.
