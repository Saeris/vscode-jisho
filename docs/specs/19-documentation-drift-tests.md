# Spec 19 — Tests that fail when the documentation goes stale

**Backlog:** new (documentation). **Status:** SPECIFIED. Follows [spec 17](./17-documentation-and-screenshots.md), which built the screenshot harness and the manual itself.

## The gap

Spec 17 delivered generated screenshots. It did **not** deliver generated prose, and the difference matters more than it sounds.

The screenshot harness asserts a **flow** before capturing it, so a broken flow fails the run rather than producing a picture of a broken state. That is genuine coverage, and it is coverage of the images. The 1,900 words of prose around them are unguarded: a sentence describing behaviour the extension no longer has passes every test in the repository.

This is not hypothetical. Two errors of exactly this kind were found by human review of the first draft, after it had been committed:

- The manual said "select the reading to hear it spoken." The speak control is a separate button, and `PlayButton` returns `null` when the system has no Japanese voice — which is why it is absent from the screenshot the sentence sat under. The prose described a control that was not there.
- The browse section described the top-level Vocab category list while embedding a screenshot of the JLPT subcategory list, and named categories ("frequency", "part of speech") that are not what the UI says.

Both were caught by a person reading carefully. Neither would have been caught again after a refactor.

## What "generated prose" should and should not mean

The obvious reading — generate the README's sentences from the code — is the wrong goal, and worth ruling out explicitly so it is not attempted later.

Prose worth reading is written. A README assembled from templates reads like one, and the Marketplace listing is the single most-read surface this project has. The manual's value is in judgment calls a generator cannot make: what to lead with, what to omit, when to say "which is the part of Japanese pronunciation that dictionaries usually leave to a number."

**So: the prose stays hand-written, and the CLAIMS it makes become assertions.** A test fails, a human edits the sentence. The test says what is wrong; it does not write the fix.

That inverts the usual generated-docs trade. Instead of docs that are always technically correct and unreadable, this gives docs that are readable and _loudly wrong_ when they drift.

## Three tiers, by what they can check

Not every claim is checkable, and pretending otherwise produces either false confidence or a suite nobody trusts. The claims sort into three kinds.

### Tier 1 — Mechanical: the README against the manifest

Pure data comparison, no browser. The README's settings and commands tables restate `package.json`, and a restatement drifts the moment the source changes.

Checks:

- Every setting in `contributes.configuration` appears in the settings table, and its **documented default matches the manifest default**.
- Every setting in the table exists in the manifest (catches a removed setting left documented).
- Every command in `contributes.commands` is either documented or **explicitly declared as deliberately omitted**.
- Every command named in the README exists in the manifest.
- Every `docs/images/*.png` referenced by the README exists, and every scenario has both a light and a dark file.
- Every scenario in `docs/images/` is used by the README, or declared unused.

The "deliberately omitted" escape hatch is required, not a concession: `Jisho: Show Startup Trace` is a diagnostic command that has no place in a user manual. A check that cannot express that gets suppressed wholesale the first time it fires, and then guards nothing. **The declaration lives in the test file, with a comment saying why** — so omitting a command is a reviewable decision rather than an oversight.

These run in Vitest, in milliseconds, in the default suite. There is no reason for them to be opt-in.

### Tier 2 — Behavioural: the README's claims against the running extension

Playwright, against a real VS Code, in `e2e/docs/`. These are the claims that are true of the product rather than of the manifest, each traceable to a sentence.

The rule that makes this tractable: **assert the claim, not the appearance.** "Results are ranked by relevance, so the word you probably meant comes first" becomes an assertion that searching 食べる puts 食べる first — not a snapshot of the results list.

Claims worth this treatment, with the sentence each guards:

| README claim                                                      | Assertion                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Four input kinds all work                                         | 図書館 / としょかん / toshokan / library each return 図書館       |
| "Conjugated input works: 食べました finds 食べる"                 | Search 食べました, first result is 食べる                         |
| "the word you probably meant comes first"                         | Search 食べる, first result is 食べる and not a rarer eat-verb    |
| A sentence is broken into labelled words                          | Paste a sentence, assert the segment count and one segment's POS  |
| "full match" is separated from "partial matches"                  | Both group headers present for a query that has each              |
| Kanji appear in their own section                                 | Searching 食べる yields a Kanji section containing 食             |
| Radicals that cannot extend the selection grey out                | Select 目, assert some radical becomes disabled                   |
| Candidates update after every stroke, unfinished drawings work    | Draw a partial 年, assert candidates are non-empty                |
| Kana open stroke order rather than searching                      | Select あ in the chart, assert the stroke player opens            |
| Hovers work in Markdown and plain text, and **not** in code files | Hover Japanese in `.md` (card appears) and in `.ts` (it does not) |
| "Add Furigana" emits `{漢字\|かんじ}`                             | Run it, assert the buffer matches that shape                      |
| Every word in an example links to its entry                       | Select a word in an example, assert navigation to that entry      |

The last of the hover pair is the one that pays for the tier. The manual states a **limitation** — code files are not covered — and a limitation is the claim most likely to become quietly false, because implementing spec 18 would make it wrong without touching anything the docs mention.

### Tier 3 — Unverifiable: state them as prose, and know that they are unguarded

Some claims cannot be asserted from inside the extension, and the honest response is to list them rather than write a weak test that appears to cover them.

- **"About 125 MB, which expands to around 450 MB on disk."** Depends on the published release artifact, not on anything the test can reach. Guardable only by the data build, and belongs there if anywhere.
- **"There is no telemetry and no network request during a lookup."** A negative over the whole runtime. A test proves the absence of requests on the paths it exercises, which is not the claim.
- **"Modelled on Shirabe Jisho."** Not a fact about this codebase.
- Everything in the FAQ about roadmap intent ("not yet", "out of scope").

Recording these is part of the deliverable. The failure mode this spec exists to prevent is _believing_ the docs are covered; a list of what is not covered is what stops the tier-2 suite from being read as total.

## Where the tests live, and why the split

| Tier | Home                           | Runs in default suite |
| ---- | ------------------------------ | --------------------- |
| 1    | `src/__tests__/readme.spec.ts` | Yes                   |
| 2    | `e2e/docs/claims.docs.e2e.ts`  | No, with `docs:shots` |
| 3    | A section of this spec         | n/a                   |

Tier 1 is fast and has no browser, so it runs constantly and catches manifest drift at the moment it happens.

Tier 2 sits with the screenshot harness, and inherits its trade: spec 17 accepted that the docs project is excluded from the default run because a minute of captures taxes every unrelated change. The same reasoning applies, and the same mitigation — the `writing-docs` skill says to run it when UI changes land.

**But the trade is better here than for the screenshots**, and worth stating: a stale claim is worse than a stale screenshot. A wrong picture is usually obvious to whoever looks at it; a wrong sentence is not, and it is the thing a reader acts on. If the docs project ever moves into CI, this is the file that justifies it.

## Naming and traceability

A failure has to point at the sentence to fix. So:

- Each tier-2 test is named for the **claim**, not the mechanism: `"claim: conjugated input finds the dictionary form"`, not `"search works"`.
- Each carries a comment quoting the README sentence it guards, so the fix is a copy-paste away from the failure message.
- When a claim is deliberately changed, the test changes in the same commit. A test that fails because the product legitimately changed is a signal to **edit the prose**, which is the whole point.

## Deliberately not in scope

- **Generating the prose.** Ruled out above, on purpose.
- **Link checking.** Every external link in the README (EDRDG, Tatoeba, CC) would mean network calls in the suite, and those URLs go stale on a timescale of years. A periodic manual check is proportionate.
- **Screenshot content assertions.** The images already assert their flows; asserting what a PNG depicts is a visual-regression problem, and the visual suite is where that belongs.
