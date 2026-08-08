# Spec 17 — The README as a user manual, and screenshots that regenerate themselves

**Backlog:** new (documentation). **Status:** SPECIFIED, not yet implemented. References: [tldraw offline's user manual](https://tldraw.notion.site/User-manual-tldraw-offline-39a3e4c324c080e7b2eacc5afd078e85) for structure, [Astro's writing style guide](https://contribute.docs.astro.build/guides/writing-style/) for voice.

## Why now

The extension is feature-complete for v1 and the README still reads as a contributor's file: 46 of its 188 lines are user-facing, the rest is build instructions. That is backwards for a VS Code extension, where **the README _is_ the Marketplace listing** — it is the page a prospective user reads before installing, and it is the only page they see. Nothing linked from it renders there.

The window matters. Once PR #1 merges, CI publishes to the Marketplace, and the listing is whatever the README was at that commit.

## Decisions made with the user

Recorded so they are not relitigated. Where a decision inverted on research, the finding that moved it is named.

| Question               | Decision                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| Where the manual lives | **Entirely in the README.** The Marketplace renders nothing else.           |
| Theme-switching images | **Dual capture, light as the `<img>` fallback** (see the constraint below). |
| Sample content         | **Chosen per scenario** to model a real task; mixed sources, see below.     |
| Screenshot E2E         | **Separate Playwright project**, not in the default run.                    |
| Attribution file       | **`THIRD_PARTY_NOTICES.md`** — the VS Code ecosystem norm.                  |
| README attribution     | **Short "Data sources" section** naming each source + licence, linking out. |
| Manifest               | Add **`icon`**, **`galleryBanner`**, **`bugs`**.                            |
| Contributor content    | Moves wholesale to **`CONTRIBUTING.md`**.                                   |

## The constraint that shaped the screenshot plan

**Theme-conditional images do not work on the Marketplace.** `<picture>` with `prefers-color-scheme` renders correctly on GitHub and is silently ignored by the Marketplace, which falls back to the `<img>` element — [microsoft/vsmarketplace#281](https://github.com/microsoft/vsmarketplace/issues/281), open since December 2021, unassigned.

So a dual-theme capture buys automatic swapping for GitHub readers and one fixed theme for Marketplace readers. **Light is the fallback**, because the Marketplace listing page is itself light and a dark screenshot on a light page reads as a rendering fault rather than a choice.

This was assumed to work when the task was scoped. It does not, and the plan absorbs that rather than pretending otherwise.

## Other Marketplace mechanics that constrain the writing

Measured against the published docs, not assumed:

- **Relative image paths are rewritten** to the GitHub repo at the `main` branch, because `package.json` carries a public `repository`. Committed screenshots therefore work on both surfaces with no absolute URLs. (`--baseImagesUrl` / `--baseContentUrl` exist to override this; we do not need them.)
- **SVG is prohibited** in README and CHANGELOG except from approved providers, and the `icon` field cannot be an SVG. Screenshots are PNG; the icon is rasterized from `media/jisho.svg`.
- **Image URLs must resolve over HTTPS.**
- `CHANGELOG.md` renders as its own Marketplace tab. Bumpy already generates it; nothing to do.

## Voice: what we took from Astro

[Astro's guide](https://contribute.docs.astro.build/guides/writing-style/) is the house style, with the parts it does not cover filled from tldraw's manual.

- Neutral, factual, calm. No humour, no whimsy, no storytelling.
- **"You" and "your".** Never _we_, _us_, _let's_ — you are not sitting beside the reader.
- **Imperative for instructions**: "Run the following command", not "you should run".
- Avoid "you should" / "you can" except when describing an outcome or stating permission.
- Short sentences and paragraphs; many readers are non-native speakers or frustrated.
- Sections start at `<h2>`. Headings are short and carry no terminal punctuation.
- Do not assume prior knowledge; expand acronyms on first use.

Astro's recipe format — verb-first title, one-sentence intro, prerequisites, numbered steps — is the shape for any task-based section.

**Astro is silent on screenshots and cross-references.** Those conventions come from tldraw and from us; they are written down in the skill so the omission is not rediscovered.

## Structure: what we took from tldraw

Read from the rendered manual, not its markup.

- `<h2>` sections in **user-journey order**: About → Install → Get started → feature areas → Troubleshooting → FAQ → Glossary. Reference material sits behind the journey, not in front of it.
- **A "Get started" section that is a numbered walkthrough**, each step paired with a screenshot of exactly that step.
- Screenshots are **cropped tight to the relevant UI** — a menu, a toolbar, a panel — never a full window. The reader's eye should land on the thing being described without hunting.
- **Captions are rare**, italic, and used only where the image needs explaining beyond its surrounding prose.
- **No annotation arrows or callout boxes.** Cursor position carries the pointing.
- Prose is image-heavy in "Get started" and image-light in reference sections. A shortcuts table has no screenshots at all.
- A collapsed **table of contents** at the top.

## The screenshot harness

`e2e/docs/` as its own Playwright project, run with `vp run docs:shots`, excluded from the default suite.

**Why separate**, given the stated goal of docs that announce their own staleness: the docs run is dual-theme across many scenarios, and the main suite's value is that it is fast enough to run constantly (currently ~1.7 min for 69 tests). Loading it with a minute of captures taxes every unrelated change. The trade is real and named: **drift will not self-announce.** The mitigation is procedural — the `writing-docs` skill says to run the docs project when UI changes land, and each scenario asserts the flow it captures, so a broken flow fails the run rather than silently producing a wrong picture.

**Naming**: `docs/images/<scenario>-<theme>.png`, so the `<picture>` block is mechanical to write and a missing pair is obvious.

**Every scenario asserts before it captures.** A screenshot of a broken state is worse than no screenshot, and this is what makes the script double as a drift alarm.

## Sample content

Screenshots need Japanese text in the editor, and the content should model a **task the reader might plausibly be doing** — the feature's value is legible from the scenario, not just from the prose. Sources are chosen per scenario:

- **The user's [Guide to Japanese](https://github.com/Saeris/guide-to-japanese)** — the "editing my own Japanese notes" scenario. The user's own content; no licensing question.
- **A mixed-language source file** — Japanese comments and string literals in TypeScript. The extension's actual home turf, and the natural setting for hover and part-of-speech highlighting.
- **Translated technical documentation** (e.g. React's Japanese docs, CC BY 4.0) — the "reading docs in Japanese" scenario. **Requires attribution** in the fixtures directory.
- **Original content** where a feature needs a specific construction exercised (a particular conjugation, a name, a slang term) and no found text does it cleanly.

Fixtures live together with a README recording each one's source and licence.

## Files

| File                     | Becomes                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `README.md`              | The user manual. Product-facing only, plus a short "Data sources" section.      |
| `CONTRIBUTING.md`        | New. Development, building, dictionary delivery, tokenizer, contribution rules. |
| `THIRD_PARTY_NOTICES.md` | New. Full licence notices for every bundled or downloaded dataset.              |
| `.claude/skills/`        | New. `writing-docs` and `regenerating-screenshots`.                             |
| `e2e/docs/`              | New. The capture scenarios.                                                     |
| `docs/images/`           | New. Committed PNGs, light and dark.                                            |

**Attribution stays partly in the README** rather than moving wholesale. EDRDG, Arphic PL, LGPL and CC BY all require attribution to travel with the distribution, and the Marketplace listing is the most-read surface. One line per source with a link to the full notices discharges that without a wall of licence text mid-manual. (The About view already carries in-app attribution; the README section is belt-and-braces, not the sole discharge.)

No attribution filename gets special GitHub UI treatment — `LICENSE`, `CONTRIBUTING` and `SUPPORT` do, attribution files do not — so `THIRD_PARTY_NOTICES.md` was chosen on ecosystem convention (Microsoft/VS Code) rather than tooling behaviour.

## Sequence

Three commits, each reviewable on its own:

1. **Skills + file split.** The skills first, because they govern everything after: `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`, README reduced to its user-facing content.
2. **The screenshot harness.** Fixtures, scenarios, `docs:shots`, the first generated images.
3. **The manual.** The README rewritten around the captures, plus the manifest fields.

## Deliberately not in scope

- **A crash reporter with a pre-filled issue template.** The user wants one — a webview crash handler offering a "Report this" button that opens a GitHub issue pre-filled with version, environment and commit information. `bugs` in the manifest is the groundwork; the reporter is its own piece of work.
- **Localising the README.** The Marketplace shows one README.
