# Hardening plan

**Date:** 2026-11-09. **Source:** [AUDIT-2026-11.md](AUDIT-2026-11.md). Finding IDs (`SM-n`, `I-n`, `P-n`) refer to that document.

## How this is ordered

Three tiers, in this order of importance:

1. **User experience.** Does the product work, stay fast, keep the user's data and trust, and recover when something fails?
2. **Developer experience.** How much does each change cost, and how often does a mistake reach a release before something notices?
3. **Agent experience.** Can an agent find the truth, and trust what the repository tells it?

Inside a tier, items are ordered by **severity × reach ÷ effort**, and then by dependencies. Each item has the same parts:

- **Fixes** — the finding IDs.
- **Do** — the change, in enough detail to start.
- **Done when** — a test or measurement that fails today and passes after the change. An item without one is not finished.
- **Size** — S (a day or less), M (a few days), L (a week or more).

## Decisions

Answered on 2026-11-09. These change what gets built, so they come first.

| #   | Question                                                        | Decision                                                                                                       |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Q1  | Should the names dictionary download on the first search (I-0)? | **No — make it opt-in.** The names section offers the download the first time; nothing provisions it silently. |
| Q2  | How big should the SQLite page cache be (H-2)?                  | **Measure 32 MB against 64 MB, then choose.** 64 MB is acceptable if it earns its memory.                      |
| Q3  | Should the sidebar keep its context when hidden (I-14)?         | **Yes.** Set `retainContextWhenHidden`; `push()` must then respect visibility.                                 |
| Q4  | Should database queries move to a worker thread (H-10)?         | **Yes.**                                                                                                       |

## Phase 0 — Done during the audit

**#20 — the packager checked a file that Lindera 5.3 no longer ships (I-10).** `main` could not be released. **Merge #20 before #16** (the version PR), or the Publish job fails while packaging.

## Phase 1 — Stop the damage (user experience, small)

Each item is independent. Together they remove the worst risks this week.

### H-1 Sanitize every field of an issue report — S

- **Fixes:** I-13.
- **Do:** In `issueUrl` (`shared/diagnostics.ts`), the one function every report goes through, run the title and `error.message` through the same home-directory rules as `sanitizeStack`. Callers then cannot forget.
- **Done when:** a test passes a Windows `EBUSY … C:\Users\<name>\…` message, and a macOS and a Linux equivalent, through `issueUrl`, and finds no account name in the title or the body. The probe from the audit fails this today.

### H-2 Give SQLite a real page cache — S

- **Fixes:** P-3, and part of P-1.
- **Do:** Set `PRAGMA cache_size` in `SqliteStore.open` (Q2 decides the size). The connection is read-only, so this changes speed and nothing else.
- **Done when:** `vp run bench:compare` against a baseline saved before the change shows the measured gains (about 3× on `ねこ`, `の`, `日` and `getKanji`). Record the extension host's memory with the panel open, before and after.

### H-3 Stop old installs from being given an unreadable dictionary — S, and urgent

- **Fixes:** I-1 (the part that protects users already installed).
- **Do:** Two parts, both needed:
  1. **Freeze `dictionary-latest` at schema 6.** Every published version (0.2.x, 0.3.x) downloads that tag and requires schema 6, so it must never carry another schema. Change `dictionary.yml` so it refuses to upload a schema other than 6 to that tag. H-8 gives new schemas their own tags.
  2. **Teach the update check to refuse an incompatible update.** `fetchRemoteVersion` already downloads the sidecar, which names the schema (`full schema6 …`). If it does not match `SCHEMA_VERSION`, do not offer the update. On the manual command, say the extension needs updating instead.
- **Done when:** a test of `checkForDictionaryUpdate` with a remote `schema7` sidecar offers nothing. `dictionary.yml` fails, in a dry run, when the schema is not 6.
- **This must ship before the next change to `schema.sql`.**

### H-4 Give errors a way to retry — S

- **Fixes:** SM-9.
- **Do:** Add a "Try again" action to `ErrorState` that calls the failed query's `refetch`. Keep "Report this problem" beside it.
- **Done when:** a component test fails a query once, presses "Try again", and sees results. Today the error state has no way out.

### H-5 Let the tokenizer recover from a failure, and stop the unhandled rejections — S

- **Fixes:** SM-5, the rejections part of SM-6.
- **Do:** Clear `cached` in `getTokenizer` when the build rejects, as `#dict()` does. Wrap the body of `PosDecorator.refresh` so a failure is logged once and the pass stops.
- **Done when:** a unit test makes the first build throw and the second succeed, and `segment()` works on the second call. A decorator test with a throwing tokenizer records no unhandled rejection.

### H-6 Decide the names download (Q1) — S to M

- **Fixes:** I-0.
- **Do:** For option (b): enable `namesQuery` only when the names dictionary exists, or after the user accepts it. The first time, the names section shows a one-line offer with the size. For option (a): correct the README, `webviewHost.ts`, `ensureDatabase.ts` and `queries.ts` so they say what the code does.
- **Done when (b):** a component test of `SearchResults` with no names dictionary sends no `searchNames` request until the user accepts.

## Phase 2 — One owner for the dictionary's lifecycle (user experience, large)

### H-7 Make the dictionary lifecycle an explicit state machine — L

- **Fixes:** SM-1, SM-4, SM-10, I-2, and the error half of SM-9.
- **Do:** Replace the two cached promises, `closeDatabases`, the update's close-then-download order, and the scattered `ensureDatabase` calls with one host-side machine. XState is already a dependency, and the stately tools can check the graph.
  - **States:** `absent` → `downloading(percent)` → `opening` → `ready` → `updating` → `ready`, and `failed(reason)`, where the reason is one of `offline`, `schema-older`, `schema-newer` or `io`. The names dictionary is a second, smaller instance of the same machine.
  - **`updating` refuses to open the database.** A query that arrives during an update waits. The handle is closed **just before the rename**, not before the download.
  - **The webview sees the machine.** A new `dictionaryStatus` host push carries the state. The panel then shows download progress on first run instead of "Searching…", and gives each `failed` reason its own recovery: retry, update the dictionary, update the extension, or report.
  - **`ErrorResponse` gets a `code`.** A query that fails because the dictionary is not ready says so, and the webview stops treating every failure as a possible bug.
- **Done when:**
  - a test issues a query during an update and shows it waits, with no reopen;
  - a test fails one open while a newer one starts, and the newer one survives;
  - a component test renders first-run progress from `dictionaryStatus`;
  - a schema-newer database shows "update the extension", not "update the dictionary".
  - The stately tools can generate the machine's paths as test cases, which suits this machine well.

## Phase 3 — Data that can change shape safely (user experience, enables performance)

### H-8 Publish each schema to its own release tag — M

- **Fixes:** I-1 (for every future version), I-9's missing half. **Depends on** H-3.
- **Do:** Publish data to `dictionary-v{SCHEMA_VERSION}`. The extension downloads the tag for the schema it was built for. Content refreshes go to the tag of the schema they were built with. `dictionary-latest` stays at schema 6 for the versions already in the field. Set `SCHEMA_FROZEN = true` and record the hash, as `schema.ts` already describes. `check-data-release.ts` checks the versioned tag.
- **Done when:** a unit test asserts that the download URL contains the schema version. A schema change can merge to `main` without changing what any published version downloads.

### H-9 Precompute tag-pair counts — M

- **Fixes:** P-1. **Depends on** H-8, because it adds a table.
- **Do:** Extend `classifier_counts` at build time with a `classifier_pair_counts(a, b, n)` table: 98 × 98, about 9,600 rows. One applied tag — the usual case — becomes one indexed read. Two or more tags keep the live path. Before H-8 lands, an interim step needs no schema change: count inside SQL with `COUNT(DISTINCT word_id) … GROUP BY` instead of returning 355,000 rows to JavaScript. That measured 1,238 → 544 ms for `#noun`.
- **Done when:** `refineCounts: #noun applied` in `bench/dictionary.bench.ts` falls from about 1,950 ms to under 5 ms, and a test shows the precomputed and live counts agree for every tag.

## Phase 4 — Keep the shared thread free (user experience)

### H-10 Move database reads to a worker thread — M to L

- **Fixes:** I-5 and every remaining stall. **Depends on** Q4.
- **Do:** `SqliteStore` is already asynchronous so this could happen "without touching a single caller" (`store.ts:96`). Run the connection in a `worker_thread` and pass results back. First measure what copying the results costs: the prose hover is about 1.1 ms today and must stay close to that.
- **Done when:** `bench/dictionary.bench.ts` shows no case regressing more than the noise floor, and a host-lag probe — the startup-trace heartbeat (SM-11) is one — records no stall over 50 ms while `refineCounts` runs.

## Phase 5 — The editor features (user experience, opt-in features)

These affect only users who turn on highlighting or code comments, so they rank below the phases above.

### H-11 Make the decoration pass interruptible, cached and per editor — M

- **Fixes:** P-2, SM-6.
- **Do:** Key `#pending` and `#generation` by editor, not document. Yield to the event loop every N lines (`await new Promise(setImmediate)`), so the `superseded()` check can actually fire. Cache each line's ranges by its text, so scrolling over coloured text costs nothing.
- **Done when:** the split-view probe from the audit passes (both editors repaint); the microtask probe abandons a pass when a keystroke arrives; and a second pass over the same viewport makes no tokenizer calls.

### H-12 Cache rule stacks for the code-comment hover — M

- **Fixes:** P-4.
- **Do:** Keep TextMate rule stacks at checkpoints (every 100 lines) per document version, so a hover tokenizes from the nearest checkpoint, not from line 0.
- **Done when:** a test hovers at line 2,000 twice and the second hover tokenizes fewer than 100 lines.

### H-13 Give speech one owner — S to M

- **Fixes:** SM-7.
- **Do:** One module owns `speechSynthesis`. Starting any speech cancels every `SpeechSequence` through their tokens, not only the queue. Read the voices again on `voiceschanged`, instead of caching `null` after one second. Resolve a stuck utterance after a timeout based on its length.
- **Done when:** a browser test with a fake `speechSynthesis` interrupts a sequence with `speak()`, and the sequence stops and reports "not playing".

### H-14 Tell the user when an editor transform does not apply — S

- **Fixes:** I-12.
- **Do:** Check the result of `editor.edit` and the document's version. If the edit is rejected, run the transform again on the current text once, then show a status message.
- **Done when:** a test changes the document during the transform and sees either a correct result or a message, never silence.

### H-15 Make the bridge robust — S

- **Fixes:** SM-3, SM-2.
- **Do:** Time out requests that never get an answer, and reject them with a clear error. Hold host pushes in the bridge until a handler subscribes, so correctness no longer depends on timing. Make request ids random, so they cannot collide across document reloads. Bound `#queuedPushes`, and check that a view's dispose event belongs to the current view before it clears anything.
- **Done when:** a bridge test with no subscriber receives a push and then delivers it on subscribe; a request with no answer rejects after the timeout.

## Phase 6 — Developer experience

### D-1 One protocol definition — M

- **Fixes:** I-3.
- **Do:** Describe each request once — `search: { request: { query: string }, response: { results: … } }` — and derive the `Request` and `Response` unions, the bridge client functions, and a handler type that ties each response to its request. Adding a request type then touches one definition and one handler, instead of five files.
- **Done when:** returning `GetWordResponse` from the `search` handler is a type error.

### D-2 Run the release steps before release day — S to M

- **Fixes:** I-11, and the class I-10 belongs to.
- **Do:** In the release gate that runs on the version PR, build the platform packages (`build:platforms`) and run `publish-vsix.ts` in a mode that prints its `vsce`/`ovsx` commands without running them.
- **Done when:** a deliberately broken packaging precondition fails the version PR, not the Publish job.

### D-3 One way to be lazy — S

- **Fixes:** I-15.
- **Do:** A small `lazy(factory, { onFailure: "retry" | "degrade" })` helper, used by the database, the tokenizer, the recognizer chunk, the comment grammar and the speech voices. The policy becomes explicit at each call.
- **Done when:** each of those uses the helper, and the policy is visible where it is constructed.

### D-4 Turn "must stay in sync" comments into checks — S

- **Fixes:** I-6, I-8, I-4.
- **Do:**
  - Build the persisted-view list from `satisfies Record<View["name"], true>`, and validate each view's fields, not only its name.
  - Make the JS sort in `search.ts` reuse one comparator that a test also applies to the SQL path; or drop the JS sort if the merge can preserve SQL order.
  - Bound the statement cache (an LRU cap, or round `IN` lengths up to a few sizes), and correct `store.ts` to match CONVENTIONS.md.
- **Done when:** adding a `View` member without listing it fails to compile; a test shows that the two ranking paths agree on a set of queries; the statement cache stays below its cap after a `refineCounts` run.

### D-5 Make deoptkit a gate — S

- **Do:** Run `deoptkit ci` once on the Linux runner (Node 24.22) and compare with the baselines recorded on Node 26. If they match, add it to `ci.yml`. If they do not, record the difference and keep separate baselines per runtime.
- **Done when:** CI fails on a new structural finding in the four bounded workloads.

### D-6 One source per benchmark — M

- **Do:** Fold each `*.bench.mjs` into its Vitest bench using `benchObserved`. First make profile mode limit iterations (the audit found that time-based runs with every category on write gigabytes of logs). That may suit an upstream option in deoptkit's preset.
- **Done when:** `bench/` has one file per subject, and `vp run bench:profile` writes logs under 100 MB with every category on.

### D-7 Stop the startup heartbeat when it has nothing more to record — S

- **Fixes:** SM-11.
- **Do:** Stop the interval when the sample buffer is full, or after a fixed time.
- **Done when:** a unit test with fake timers shows the interval cleared.

## Phase 7 — Agent experience

### A-1 Correct the stale and false documentation — S

- **Fixes:** the table in the audit's section 4.
- **Do:** Correct each entry, and mark spec 21 as implemented. `bench/README.md` is already corrected in this PR.
- **Done when:** none of the listed claims is still in the tree.

### A-2 Write an architecture map — S to M

- **Do:** Add `docs/ARCHITECTURE.md`: the two runtimes and what each may use, the bridge protocol, the lifecycles (after H-7, link to the machine definitions — they become the documentation), the data and release pipelines, and where each invariant in the audit is enforced. Link it from `CLAUDE.md` and `CONTRIBUTING.md`.
- **Done when:** an agent can answer "what happens if the dictionary download fails halfway?" from that document and one linked file.

### A-3 Make measured numbers in comments checkable — S

- **Do:** Add a convention to CONVENTIONS.md: a comment that quotes a measurement names the bench case that reproduces it (for example, "see `bench/dictionary.bench.ts`, `refineCounts: #noun`"). A stale number can then be checked with one command. Apply it to the numbers this audit relied on.
- **Done when:** the convention exists and the comments in `queries/browse.ts`, `posDecorations.ts`, `grammar.ts` and `tokenizer.ts` follow it.

### A-4 Put the project's known hazards where an agent will read them — S

- **Do:** Add a short project section to `CLAUDE.md`: the extension host's Node and the webview's Chromium are different runtimes (`Uint8Array.fromBase64` exists in only one); Windows cannot replace or delete an open file; Yarn quarantines new packages for three days and `--no-time-gate` does not work on `install`; `dictionary-latest` is shared by every published version; and bumping Lindera changes the dictionary format. Each of these cost a debugging session on this project.
- **Done when:** each hazard in that list links to the code or document that enforces it.

## Suggested order

1. **Now:** #20, then H-3 (before any schema change), H-1, H-2, H-5, H-4.
2. **Next:** Q1 and H-6; then H-7, the largest change in user experience.
3. **Then:** H-8 and H-9 together, and D-1 and D-2 alongside them, since H-7 and H-8 both add messages and release steps.
4. **After:** decide Q4 with fresh numbers, then the editor items (H-11 to H-15), D-3 to D-7, and the agent-experience items in any order.
