# Pre-publish checklist

What to verify before the first Marketplace release, and why each item is here. Most of these are
already enforced by CI — the ones that are not are called out, because those are the ones that can
still ship broken.

The publish itself is automatic: merging Bumpy's **🐸 Versioned release** PR (#1) triggers
`release.yml`, which gates on the full test suite and the E2E suite, then publishes every platform
target. Nothing below needs doing by hand unless it says so.

## Blocking

### The dictionary release must match this build's schema

**Enforced** by `scripts/check-data-release.ts`, which runs as the first step of the publish job.

This is the item that would have broken the first launch. The extension downloads its dictionary
from the rolling `dictionary-latest` GitHub Release on first activation, and it refuses to open a
database whose schema it does not recognise. The "Dictionary Data" workflow silently broke on
2026-08-03 and stayed broken through the schema bump to v6, so the published artifacts sat at
schema 5 — present, checksummed, and unopenable by the shipping extension.

The guard now compares the published `.version` sidecar's `schema<N>` stamp against
`SCHEMA_VERSION` and fails the release on a mismatch. To verify by hand:

```sh
vp exec node scripts/check-data-release.ts
```

If it fails, re-run the **Dictionary Data** workflow and wait for it to finish before releasing.

### Both CI workflows green on `main`

**Enforced**: `release.yml` gates on `full-test.yml` and `e2e.yml`.

Worth checking the E2E gate specifically. It runs the whole suite in ONE Playwright invocation
against the COMMON dictionary, which differs from a typical local run in two ways that have both
caused a green-locally/red-on-CI split:

- **Ordering.** One VS Code is shared across files, so a suite that leaves the panel somewhere
  unexpected breaks whatever runs next. Reset in `afterAll`.
- **Fonts.** A Linux runner wraps text differently from a Windows machine, so any assertion that
  depends on where a line breaks is environment-dependent and does not belong in the suite.

Reproduce CI's exact shape locally with:

```sh
vp run build:data          # the COMMON build, which is what CI uses
vp pack && vp build
vp exec playwright test    # one invocation, all files
```

### The packaged `.vsix` contains what it should

**Not enforced.** Run `vp exec vsce package` and read the file list. Two things to confirm:

- `media/icon.png` is present. `.vscodeignore` excludes `media/**`, and the icon is re-included by
  an explicit negation — a manifest pointing at a file that is not in the package ships a broken
  listing.
- No test residue. `e2e/`, `test-results/`, `.vitest-attachments/` and `dist/bench/` have all been
  found in a built package before; reading the list is the only way to know what actually ships.

### Publish credentials

`VSCE_PAT` and `BUMPY_GH_TOKEN` are set as repository secrets. **A Marketplace PAT expires**, and
an expired one fails the publish after the gates have already passed — check its expiry before a
release rather than after a failure.

Open VSX is mentioned in a comment in `release.yml` but is **not implemented**: `publish-vsix.ts`
publishes to the Marketplace only. Not a blocker, but the comment overstates what happens.

## Worth checking, not blocking

### The listing renders

The README is the Marketplace listing, and its screenshots are fetched from GitHub at `main` rather
than from the package. So they only resolve once the commit is pushed — a locally-correct README can
still render broken images on the listing.

`src/__tests__/readme.spec.ts` checks that every referenced image exists and that the settings and
commands tables match the manifest, so the mechanical part is covered. What it cannot check is
whether the page reads well; skim it once on GitHub, where the `<picture>` blocks resolve the same
way they will for a dark-theme reader.

### First-run experience, by hand

The one path no test covers, because CI always has a dictionary already: install the built `.vsix`
into a clean VS Code profile and open the panel. It should download the dictionary with a progress
notification, then search. This is the flow every new user takes and the one where a broken
`dictionary-latest` shows up as "the extension does nothing".

```sh
code --user-data-dir /tmp/jisho-clean --install-extension dist-vsix/<file>.vsix
```

### Version and changelog

Bumpy's version PR carries both. Read the changelog entries as a user would — they describe what
someone notices in the extension, not what changed in the code — and confirm the version bump
matches the largest change in the set.

## After publishing

- The listing takes a few minutes to appear, and longer to be searchable.
- Install from the Marketplace into a clean profile and repeat the first-run check. A `.vsix` that
  works locally and a published extension that works are not quite the same claim: the Marketplace
  serves a per-platform target, and only the one matching your machine gets exercised locally.
- `Jisho: Report an Issue` should open a prefilled GitHub issue. It is the feedback path the
  listing points at, and the first release is when it starts mattering.
