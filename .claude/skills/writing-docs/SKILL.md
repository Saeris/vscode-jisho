---
name: writing-docs
description: Voice, structure and screenshot conventions for this repo's user-facing documentation — the README (which is the VS Code Marketplace listing), CONTRIBUTING.md, and THIRD_PARTY_NOTICES.md. Use when writing or editing any of those, adding a feature section, or reviewing documentation prose.
---

The README **is the Marketplace listing**. It is the page a prospective user reads before installing, and it is the only page they see — nothing linked from it renders there. Write it for that reader, not for a contributor.

Full rationale and the research behind these rules: [docs/specs/17-documentation-and-screenshots.md](../../../docs/specs/17-documentation-and-screenshots.md).

## Where each thing goes

| Content                                               | File                     |
| ----------------------------------------------------- | ------------------------ |
| What the extension does, how to use it, settings      | `README.md`              |
| Building, testing, the data pipeline, how to fix bugs | `CONTRIBUTING.md`        |
| Full licence notices for bundled data                 | `THIRD_PARTY_NOTICES.md` |
| Design decisions and their history                    | `docs/specs/`            |

If a section is about _making_ the extension rather than _using_ it, it belongs in `CONTRIBUTING.md`. The one deliberate exception: a short "Data sources" section stays in the README, because several licences (EDRDG, Arphic PL, LGPL, CC BY) require attribution to travel with the distribution and the listing is the most-read surface.

## Voice

From [Astro's writing style guide](https://contribute.docs.astro.build/guides/writing-style/), which is the house style.

- Neutral, factual, calm. No humour, no whimsy, no storytelling.
- **"You" and "your". Never "we", "us", "our", "let's".** You are not sitting beside the reader.
- **Imperative for instructions.** "Run the following command", not "you should run the following command".
- Avoid "you should" and "you can" except when describing an outcome or granting permission.
- Short sentences and paragraphs. Many readers are non-native English speakers, and many are frustrated when they arrive.
- Do not assume prior knowledge. Expand an acronym on first use.
- Do not write "simply", "just", "easy", or "obviously". If it were easy the reader would not be reading.

## Structure

From [tldraw offline's user manual](https://tldraw.notion.site/User-manual-tldraw-offline-39a3e4c324c080e7b2eacc5afd078e85), which is the model for the README's shape.

- Sections start at `<h2>`. Headings are short and carry **no terminal punctuation**.
- Order sections by the **user's journey**, not by the code's structure: what it is → install → a first walkthrough → feature areas → troubleshooting → FAQ. Reference material sits behind the journey.
- A collapsed table of contents at the top (`<details>`), because the page is long.
- Task sections follow Astro's recipe shape: **verb-first heading**, one-sentence intro, prerequisites if any, then numbered steps.
- Name UI elements in **bold** exactly as they appear on screen. Use `code` for commands, file paths, settings keys and literal input.
- Write a command palette action as **Jisho: Look Up Selection**, matching what the palette shows.

## Screenshots

Astro's guide says nothing about images. These conventions are ours, taken from tldraw.

- **Crop tight to the relevant UI** — the sidebar, a hover card, a menu. Never a full window. The reader's eye should land on the subject without hunting.
- **Captions are rare**, italic, and only where the image needs explaining beyond the surrounding prose. Most images need none.
- **No annotation arrows, boxes or numbered overlays.** If an image needs an arrow to be understood, crop it tighter or split it.
- Every image needs **alt text describing what it shows**, not "screenshot".
- Every screenshot is committed as a **light/dark pair** and embedded with `<picture>`. See below — the fallback theme is not arbitrary.
- Screenshots are **generated, never hand-taken**. Add a scenario to `e2e/docs/` instead; see the `regenerating-screenshots` skill.

### The `<picture>` block

```html
<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset="docs/images/NAME-dark.png"
  />
  <img alt="What the screenshot shows" src="docs/images/NAME-light.png" />
</picture>
```

**The `<img>` must be the LIGHT image.** GitHub honours the `<source>` and swaps by theme; the Marketplace ignores it entirely and renders the `<img>` ([microsoft/vsmarketplace#281](https://github.com/microsoft/vsmarketplace/issues/281), open since 2021). The Marketplace page is light, so a dark screenshot there reads as a rendering fault.

## Marketplace constraints

These are enforced by the Marketplace, not by preference. Breaking one ships a broken listing.

- **No SVG** in README or CHANGELOG, and the manifest `icon` cannot be an SVG. Screenshots are PNG.
- **Relative image paths are rewritten** to the GitHub repo at `main`, because `package.json` has a public `repository`. Use repo-relative paths (`docs/images/…`); do not hardcode absolute URLs.
- Image URLs must resolve over **HTTPS**.
- Only the README renders. **A link to `docs/` is a link off the listing** — fine for depth, never for something the reader needs.
- `CHANGELOG.md` is generated by Bumpy and renders as its own tab. Do not hand-edit it.

## Before committing documentation

- Re-read for "we" and "let's". They are the easiest rule to break.
- Check every relative link resolves from the **repo root**, since that is how the Marketplace rewrites them.
- If a screenshot's UI changed, run `vp run docs:shots` — do not edit a PNG by hand.
- A bump file is **not** needed for documentation-only changes; Bumpy entries describe what a user notices in the extension.
