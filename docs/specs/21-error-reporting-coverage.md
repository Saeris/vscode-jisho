# Spec 21 — The errors the crash boundary does not catch

**Backlog:** new. **Status:** SPECIFIED. Follows [spec 20](./20-crash-and-issue-reporting.md), which named this as a follow-up.

## What spec 20 actually left uncovered

Spec 20 said React boundaries "do not catch errors in event handlers, async code, or the host process", and implied those errors "surface as VS Code error notifications today". **The second half was wrong**, and the correction changes what this spec has to build.

Measured against the code rather than assumed:

- `vscode.window.showErrorMessage` is **called nowhere**. Nothing in this extension has ever raised a VS Code error notification.
- A failed request becomes an `error` response, which the bridge turns into a promise rejection, which TanStack Query surfaces as `isError`.
- `DetailView` — the shell behind the word page, kanji page, more-examples, names, stroke order and the component tree — **does render that error**, as `error.message`. `SearchResults` renders its own.

So the picture is not "errors vanish". It is narrower and more specific:

| Path                                    | Today                                  | Gap                     |
| --------------------------------------- | -------------------------------------- | ----------------------- |
| Query failure in a detail view          | Message rendered by `DetailView`       | **No way to report it** |
| Query failure in search                 | Message rendered by `SearchResults`    | **No way to report it** |
| Render crash                            | Error boundary, with a report button   | Covered by spec 20      |
| Rejected promise with no query attached | Nothing at all                         | **Silent**              |
| Throw during `activate()`               | VS Code's own "cannot activate" notice | Generic, unreportable   |

The real gap is therefore **not that errors are invisible — it is that a visible error is a dead end.** The user reads "Dictionary schema version 5 does not match the required 6", and there is nothing to click. That is worse than a crash, which at least offers a report button.

## The principle

**Anywhere an error is shown to a user, it must be reportable.** One rule, and it decides the whole design: the work is not adding error handling, it is attaching the reporter to the error handling that already exists.

This is deliberately smaller than "catch everything". A blanket global handler that reported every rejection would produce noise — an aborted fetch, a cancelled query, a benign race — and a reporter that cries wolf gets ignored exactly when it matters.

## The pieces

### 1. A shared `ErrorState` component

`DetailView` and `SearchResults` each render a bare `<p>` with a message. Both become one component that renders the message **and** a report action, so a user reading an error has somewhere to go.

It carries the same treatment the crash screen does, for the same reason: a failure to load a word looks, to someone who just downloaded 450 MB, like their dictionary is broken.

The report it files is a **non-crash** report carrying the error's message, but no stack — a query rejection's stack is the bridge's plumbing, not the cause, and it would be noise in an issue. The message plus the diagnostics is what identifies these.

### 2. Unhandled rejections in the webview

A `window.addEventListener("unhandledrejection")` handler, because a rejection with no query attached currently disappears with no user-visible sign at all.

**It does not open a reporter.** It logs to the console and records the last rejection so the crash reporter can include it as context if a crash follows. Prompting on every unhandled rejection is how a reporter becomes noise; the value here is that when something DOES go wrong, the report says what preceded it.

### 3. Activation failure

A `try`/`catch` around `activate()`. VS Code already shows its own "cannot activate" notification, which is generic and unreportable — the catch replaces it with a notification carrying a **Report** action.

This is the highest-value case in the spec and the least likely to fire. When activation fails the extension is completely unusable, the user has no panel to report from, and every other pathway in spec 20 is unreachable. It is also the one place a report is worth interrupting for.

### 4. Host-side notification helper

The one place `showErrorMessage` gets called, so an error notification always carries the same **Report** action. Introduced now rather than scattered later, since the whole point is that no error surface is a dead end.

## What stays uncovered, deliberately

- **Errors in event handlers.** React boundaries do not catch them and there is no general interception point that is not a global `window.onerror`. Those that matter route through a query and are covered by (1).
- **The output channel's contents.** Deferred by the user: the log holds search queries, so attaching it needs a redaction pass, and building that sanitizer from scratch is a bigger surface than it looks. **Research existing solutions before writing one.**
- **Automatic reporting.** Unchanged from spec 20: every report is user-initiated. The extension promises no telemetry.

## Testing

- **Component**: `ErrorState` renders its message and its report action; the report carries the message and no stack.
- **Unit**: the rejection recorder keeps the most recent rejection and is included in a subsequent crash report.
- **E2E**: an error surfaced in the panel offers a report action.

The activation catch is not E2E-tested: forcing a genuine activation failure means breaking the extension in the fixture, which would fail every other suite. Its logic is one `try`/`catch` and its value is in existing at all.
