# Spec 20 — Crash reporting and issue filing

**Backlog:** new. **Status:** SPECIFIED, not implemented. Named as out of scope by [spec 17](./17-documentation-and-screenshots.md), which added `bugs` to the manifest as the groundwork.

## Why

The Marketplace listing carries a link to GitHub Issues. That is the whole of the current feedback path, and it is close to useless in practice: it drops the user on an empty issue form and asks them to reconstruct, from memory, which version they are on, which dictionary they have, and what they were doing. Most people will not, and the reports that do arrive are missing the fields that would let a bug be traced to a release.

The goal is **the lowest-friction path to an actionable report**. Actionable is the operative word — a one-click "something broke" is no better than the empty form. What makes a report useful is the environment it carries, and the user should never have to assemble that by hand.

## Three surfaces, one payload

The same diagnostic snapshot serves all three. That is the central design decision: one collector, three places it surfaces, so a field added for the crash reporter shows up everywhere and nothing drifts.

| Surface                  | Trigger                              | Carries                         |
| ------------------------ | ------------------------------------ | ------------------------------- |
| Webview error boundary   | A React render crash                 | Diagnostics **+ error + stack** |
| `Jisho: Report an Issue` | The user chooses to, any time        | Diagnostics                     |
| About view: copy button  | The user wants the table for a paste | Diagnostics, as Markdown        |

The About surface matters beyond the reporters. A user filing a report through some other channel — a discussion, a comment on someone else's issue — needs the same table, and "run this command and paste what it copies" is a thing a maintainer can ask for. It also gives the diagnostics a permanent, discoverable home rather than one that only appears after something has gone wrong.

## What the snapshot contains

Chosen to answer "which build, against which data, on what" — the questions that decide whether a report is reproducible.

| Field                         | Source                                             | Why it is needed                                                       |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| Extension version             | `context.extension.packageJSON.version`            | Which release                                                          |
| Extension commit              | Build-time constant (see below)                    | Which _build_ of that release; a republish shares a version            |
| VS Code version               | `vscode.version`                                   | The host API surface                                                   |
| Node version                  | `process.versions.node`                            | The extension host runtime; `node:sqlite` behaviour is version-bound   |
| Chromium version              | `process.versions.chrome` (host) / UA (webview)    | The webview runtime; CSS and layout bugs are version-bound             |
| OS                            | `process.platform`, `os.release()`, `process.arch` | Native binding failures are per-platform (lindera, node:sqlite)        |
| Dictionary variant            | DB `meta.variant`                                  | full vs common changes what results exist                              |
| Dictionary revision           | The `.db.version` sidecar written by `download.ts` | Which dictionary release; the data is versioned independently          |
| Dictionary built at           | DB `meta.builtAt`                                  | Pins the data build even when the release tag is reused                |
| Schema version                | DB `schemaVersion`                                 | A schema mismatch is its own failure class                             |
| Source dataset dates          | DB `meta.dictDate`, `kanjidicDate`, `tatoeba*Date` | Upstream data changes cause "wrong result" reports with no code change |
| Names DB present              | Whether the optional names DB is provisioned       | Name lookups fail differently when it is absent                        |
| Settings that alter behaviour | The non-default subset of Jisho's settings         | A bug that only reproduces with highlighting on                        |

**Settings are included as a diff against defaults, not in full.** The whole block is noise in a report; the two settings someone changed is the reproduction hint.

### The commit hash needs a build step

`process.env.GITHUB_SHA` is not available at runtime — it exists in CI, and the packaged extension is a static bundle. So the hash has to be **stamped at build time** into the extension bundle as a constant, via a define in the build config, defaulting to `"dev"` outside CI.

This does not exist today and is part of the work. Without it, "which build" is answerable only to the granularity of a version number, and a republished version is indistinguishable from the original.

## Sanitizing the stack

A webview stack trace names its script as a `vscode-resource` URL that embeds an absolute path:

```
at WordDetail (https://file+.vscode-resource.vscode-cdn.net/c%3A/Users/NAME/.vscode/extensions/saeris.vscode-jisho-1.0.0/dist/webview/index.js:48213:19)
```

That leaks the user's account name and directory layout into a public issue. **Non-negotiable: the report is public, and the user is one click from posting it.**

Rules, applied in order:

1. Rewrite any `vscode-resource`/`file:` URL down to the bundle-relative path: the frame above becomes `at WordDetail (webview/index.js:48213:19)`.
2. Replace a home-directory prefix (`/Users/x`, `/home/x`, `C:\Users\x`) anywhere else in the text with `~`.
3. Truncate to **20 frames**, with a `… N more frames` marker. Measured: 40 realistic frames encode to ~7.8 KB, which alone overruns GitHub's URL ceiling.

The sanitizer is pure and unit-tested against real captured stacks. It is the piece most worth testing, because its failure mode is a privacy leak that no one notices until it is on a public issue.

## The URL, and its ceiling

GitHub prefills from `?title=&labels=&body=`, and the practical ceiling is **~8 KB** for the whole URL. Percent-encoding inflates Markdown by roughly 1.2× and Japanese text by ~3×, so the budget has to be checked after encoding, not before.

The order of trimming, when over budget: drop source dataset dates, then shorten the stack further, then drop the settings diff. The environment table is never dropped — it is the reason the feature exists.

If the URL still exceeds the ceiling, **fall back to copying the report to the clipboard** and opening a blank issue form with a note to paste. Worse UX, still actionable, never a truncated report that silently lost its stack.

## Issue templates

`.github/ISSUE_TEMPLATE/` does not exist yet. Two forms:

- **`bug_report.yml`** — targeted by both reporters, with a body field the prefill populates.
- **`config.yml`** — `blank_issues_enabled: false`, so the un-prefilled path is a deliberate choice rather than the default.

The prefilled body must **lead with the user's own description prompt**, not the environment table. A report that opens with a wall of diagnostics invites the reporter to submit without adding anything, and "what were you doing" is the field a maintainer needs most and can least reconstruct.

## The error boundary

A class component at the webview root — `getDerivedStateFromError` plus `componentDidCatch` — because React has no hook equivalent.

What it renders matters as much as that it catches:

- **What happened**, in plain language. Not the stack; the stack goes in the report.
- **That the dictionary is not damaged.** A crash in the panel looks, to a user, like their 450 MB download broke. It did not, and saying so prevents an uninstall.
- **A way back**: a "Reload" action that resets the boundary and returns to search, so a transient render bug does not require reopening the sidebar.
- **The report button**, as the secondary action rather than the primary. The primary is getting back to work.

Placement is at the **root, inside the providers**, so a crash in any view is caught while the bridge stays available to send the report. A boundary outside the providers could not report, which is the one thing it exists to do.

### What it cannot catch

Worth stating so the coverage is not overestimated. React boundaries do not catch errors in event handlers, async code, or the host process. A `postMessage` failure, a query rejection, or a host-side throw all pass through it untouched.

~~Those surface as VS Code error notifications today~~ — **this was wrong**, and [spec 21](./21-error-reporting-coverage.md) corrects it. `showErrorMessage` is called nowhere in this extension. A query rejection is rendered as a message by `DetailView` or `SearchResults`, and a rejection with no query attached is silent. The gap is not that errors are invisible; it is that a visible error has nothing to click. Spec 21 covers that.

## Host command

`Jisho: Report an Issue`, contributed alongside the existing commands, collecting the same snapshot and opening the same prefilled URL through `vscode.env.openExternal`.

`openExternal` is not currently used anywhere in the host; it is the only new VS Code API this spec needs.

## Testing

- **Unit**: the sanitizer against real captured stacks, asserting no home directory survives; the URL builder's budget arithmetic, including the fallback path; the settings diff against defaults.
- **Component**: the boundary renders its screen when a child throws, and its Reload action clears the error.
- **E2E**: `Jisho: Report an Issue` appears in the palette. The URL is asserted by intercepting `openExternal` rather than by opening a browser.
- **Docs**: a README section under Troubleshooting, and its claims covered by [spec 19](./19-documentation-drift-tests.md)'s tier 1 (the command must appear in the manifest table).

## Deliberately not in scope

- **Automatic reporting.** Every report is user-initiated. Silent collection is telemetry, and the README promises there is none.
- **Structured error taxonomy.** [nostics](https://github.com/vercel-labs/nostics) is the user's stated direction for giving known failure cases structure. It is a separate pass and this spec should not pre-empt its shape.
- **Catching host-process and async errors.** Noted above as a follow-up.
- **Log attachment.** The output channel can hold user text (search queries). Attaching it needs a redaction pass and a consent step, which is its own piece of work.
