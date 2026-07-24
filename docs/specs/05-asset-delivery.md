# Spec 05 — Automated data builds, asset delivery, and update lifecycle

**Backlog:** new (#39). **Blocked on:** nothing, but two decisions in "Open questions" want the user's call before implementation. This is the **last major piece before the first release** — nothing ships to users until the `dictionary-latest` release exists.

## Objective

The dictionary database is too large to bundle (~400 MB built, ~129 MB gzipped) so it downloads on first run. Today the _client_ for that is complete and the _producer_ does not exist: `gh release view dictionary-latest` → "release not found". Build it, automate it, and give the extension a lifecycle around it — version compatibility, update checks, and cleanup.

## What already exists (do not rebuild)

- **`src/host/download.ts`** — fetches `<prefix>.zst`, verifies sha256, zstd-decompresses via a `.part` temp file, renames atomically, writes a `.version` sidecar. Handles both `jisho-full.db` and `jisho-names.db` prefixes.
- **`src/host/ensureDatabase.ts`** — dev backend (copy `assets/jisho.db`) vs installed backend (download); compares version sidecars and re-copies on mismatch; offline-first (never blocks activation on a network check).
- **`scripts/build-data.ts --full` / `--names`** — already emits the full release trio per artifact: `.zst`, `.zst.sha256`, `.zst.version` (zstd level 19, measured ~29% smaller than gzip -9). Version string is `` `${VARIANT} ${dict.dictDate} ${builtAt}` ``.
- **`.github/workflows/release.yml`** — Bumpy-driven extension publish (Marketplace + Open VSX) on push to main.

## Decisions already made

1. **SVGs stay bundled in the .vsix — do NOT move them to downloads.** The user raised archiving them like the DB; this spec deliberately declines. BACKLOG #31 moved them _out_ of the database precisely because a second delivery path created an invisible staleness bug (`build:strokes` updated files while the extension served DB rows; tests passed against new data while the running extension rendered old — "that cost a full debugging session"). Downloading them reintroduces exactly that two-source-of-truth split. The measured cost of keeping them: **the packaged .vsix is 30.6 MB total** (3,946 files) — unremarkable for the Marketplace, and the SVGs are read host-side per request with no CSP involvement. Revisit only if the .vsix approaches ~100 MB.
2. **Schema version gates compatibility, not the data version.** See below — this is the correctness core.
3. **Release-triggered rebuilds, not schedule-only** (user): a schema change must produce a compatible artifact _before_ the extension that requires it reaches users.
4. **Rolling `dictionary-latest` tag**, not a release per build: the client hardcodes that base URL, and asset downloads have no bandwidth limits.

## 1. Schema versioning (build this first — it is the correctness core)

Today's version string encodes data freshness only. Spec 04 adds a `radicals.position` column; a user holding a cached DB from before it, running an extension that requires it, gets runtime failures or silently-empty results.

- `src/data/schema.sql` gains a **`SCHEMA_VERSION` constant** mirrored in `src/shared/schema-version.ts` as `REQUIRED_SCHEMA_VERSION` (a plain integer, bumped by hand in the same commit that edits the schema). Build writes it to `meta` as `schemaVersion`.
- `ensureDatabase` reads the cached DB's `schemaVersion` **before** using it. Below `REQUIRED_SCHEMA_VERSION` → discard and re-download, regardless of data version. Above it (user downgraded the extension) → also re-download; a newer schema may have dropped a column this build reads.
- Guard against the version living in two places drifting: a unit test asserts `meta.schemaVersion` in `assets/jisho.db` equals `REQUIRED_SCHEMA_VERSION` (skipped when the DB is absent, matching `db.spec.ts`).
- **Artifacts are namespaced by schema version**: `jisho-full.db@v3.zst`. An old extension keeps resolving its own artifact after a new schema publishes, so upgrading the schema never breaks installed clients. This is what makes release-triggered rebuilds safe.

## 2. Data build workflow (`.github/workflows/dictionary.yml`)

Triggers:

- `workflow_dispatch` (manual, with a `force` input)
- `schedule` monthly (JMdict updates weekly; monthly is plenty for a dictionary)
- **`push` to main when `src/data/schema.sql` or `scripts/build-data.ts` changes** — the user's requirement. Implemented with `paths:` filters.

Jobs (word DB and names DB **separate**, so a names failure never blocks the word DB):

1. Check whether the target artifact already exists for this schema version + JMdict date; skip unless `force` (keeps the monthly run cheap and idempotent).
2. `vp run build:data:full` / `build:data:names`.
3. **Verify before publishing** — re-open the built DB, assert a known query answers (食べる resolves, a kanji resolves, `meta.schemaVersion` is right) and the sha256 matches. A corrupt artifact silently breaks every new install.
4. `gh release upload dictionary-latest --clobber`, **`.zst` LAST**: the client fetches `.sha256` and `.version` first, so uploading the archive before its checksum leaves a window where a mid-publish download fails verification. Ordering makes the swap effectively atomic.

Runner limits (verified): 2 GiB per asset, no total-size or bandwidth caps, ~14 GB disk, 16 GB RAM. The build holds parsed JSON in memory — if the full build OOMs, raise Node's heap (`NODE_OPTIONS=--max-old-space-size=…`) before restructuring the script.

**Measured full build (2026-07-24, with F1 examples + F3 similar-kanji, local):** 10m34s wall, exit 0, **no OOM at `--max-old-space-size=8192`** — no streaming needed. Output DB **405.9 MB raw → 114.4 MB zst (71.8% smaller)**; 217,974 words, 189,292 sentence rows (32,031 inline Tanaka + 157,261 Tatoeba pool — the pool grows sub-linearly because it is capped at 20/word), 24,207 similar-kanji rows. The 114 MB (vs the ~96 MB the pre-F1 estimate assumed) is F1's furigana: each sentence stores both `ja` and `ja_furigana`. Well within the runner's limits; the workflow sets the 8 GiB heap defensively and does not need the streaming path.

### As built (2026-07-24) — where the workflow differs from the plan above, and why

`dictionary.yml` and `scripts/verify-db.ts` are implemented. Two deliberate deviations from §1–§2, both correct for the v1 (single-schema-version) release:

- **Artifacts are NOT schema-namespaced yet.** The plan called for `jisho-full.db@v3.zst`, but the download client (`download.ts`) fetches the unnamespaced `jisho-full.db.zst` / `jisho-names.db.zst`, and the schema version is frozen at v1 until publish (there is no second version for an old client to keep resolving). Namespacing only earns its keep once ≥2 schema versions coexist; it is a coordinated client+workflow change to make at the FIRST post-v1 schema bump, not now. Until then, unnamespaced matches the client exactly.
- **Trigger is schema-change + manual, NOT scheduled.** The user's hard requirement — "release-triggered, not schedule-only" — is met via `paths:` on `src/data/**.sql`, `src/shared/schema.ts`, `scripts/build-data.ts`. The monthly `schedule` + skip-if-exists idempotence (§2 item 1) is dropped for now: JMdict data refreshes are a manual `workflow_dispatch` away, and a monthly rebuild without the skip-if-exists check would re-upload ~230 MB for no change. Add the schedule + existence-check together if data staleness becomes a real concern.

The verify step (§2 item 3) is `scripts/verify-db.ts`: re-opens the DB, asserts `meta.schemaVersion` matches `SCHEMA_VERSION`, canaries 食べる + 食 + row counts, and re-checks the `.zst` against its `.sha256` sidecar. Word and names DBs verified separately. The `.zst`-LAST upload ordering (§2 item 4) is implemented (sidecars uploaded first, archives second).

## 3. Release ordering (the coupling that must not break)

`release.yml` publishes the extension; `dictionary.yml` publishes its data. A release whose `REQUIRED_SCHEMA_VERSION` has no matching artifact ships a broken first-run experience.

**Gate the release on artifact existence**: before `bumpy ci release`, check that the data artifacts (plus their `.sha256`, `.version` sidecars) exist on `dictionary-latest`; fail the release with a clear message if not. The data build runs _first_ (on the schema-change push) and the release then finds it — no ordering race, just a precondition. (This gate is part of task C — wiring the check into `release.yml`. Until artifacts are namespaced — see "As built" — check the plain `jisho-full.db.zst` name the client fetches, not `@v<N>.zst`.)

## 4. Update lifecycle (the Wallaby-style model the user asked for)

Wallaby has both automatic and manual core updates; mirror that shape.

- **Automatic check, throttled and offline-safe.** On activation, if `Date.now() - lastCheck > 24h` (stored in `context.globalState`), fetch only the tiny `.version` file for the current schema. Never block activation — fire and forget, failures silent (offline-first is an existing principle).
- **Notify, don't force.** A newer data version → a non-modal notification: "A newer dictionary is available (JMdict 2026-08-01). Update now?" with _Update_ / _Later_ / _Never_. "Never" writes a `dictionary.autoCheck` setting (add to `contributes.configuration`, alongside the settings from spec 05's groundwork commit).
- **Manual command**: `Jisho: Check for Dictionary Updates` — same path, but reports "already up to date" rather than staying silent, and ignores the throttle.
- **Update = download to a temp path, verify, then swap.** Never delete the working DB before the replacement verifies; a failed update must leave the user with a working dictionary.

## 5. Cleanup (the user's disk-space concern)

Nothing prunes `globalStorage` today, and both the schema namespacing and updates create garbage.

- After a successful swap, delete the superseded `.db` and its `.version` sidecar.
- On activation, sweep `globalStorage` for `jisho*.db*` files that match neither the active schema version nor the current sidecars, and delete them — this catches DBs orphaned by an extension _upgrade_ (the schema-version bump changes which artifact is current, and the old one is dead weight at ~400 MB).
- Also remove stale `.part` files from interrupted downloads.
- Never delete the names DB just because it is unused — it is a deliberate opt-in download; only remove it when superseded.
- A `Jisho: Clear Downloaded Dictionaries` command (for support: force a clean re-fetch) is cheap once the sweep exists.

## 6. Optimizations (measured, not assumed)

Investigated during the analysis; recording so they are not re-derived:

- **`search_terms.term_lower` duplicates `term` byte-for-byte in 99% of rows** (423,905 / 427,246 in the common subset) — but all text is only ~5 MB of the 51 MB file, and gzip already collapses it. Making it nullable would touch every search query for ~1–2 MB compressed. **Not worth it.**
- **No `VACUUM` win**: `freelist_count` is 0.
- **zstd instead of gzip** — typically 15–25% smaller than gzip -9 and faster to decompress; Node 22+ has native zstd and `engines.node` is already `>=22`. Worth doing when touching the download path anyway; keep gzip support so in-flight clients don't break.
- **Drop indexes before bulk insert, recreate after** — check whether `build-data.ts` already does this; usually a large build-time win at full scale.
- The genuinely large artifact is the **names DB (409 MB → 131 MB gzipped)** for an optional feature — a data-scope question (does JMnedict need all 743k entries?), not a compression one. See open questions.

## Test plan (behavior-first)

- **Unit**: `schemaVersion` mismatch forces re-download (both directions — older _and_ newer cached DB); the sweep deletes orphans but never the active DB or an opt-in names DB; version-sidecar comparison logic. `download.spec.ts` already covers checksum verification — extend it for the schema-namespaced URL shape.
- **Drift guard**: `meta.schemaVersion` equals `REQUIRED_SCHEMA_VERSION` (skip when `assets/jisho.db` is absent).
- **Workflow**: dry-run `dictionary.yml` via `workflow_dispatch` against a scratch tag before pointing it at `dictionary-latest`.
- **E2E is not the right layer** — a 129 MB download in CI is disproportionate. Cover the _decision_ logic in unit tests and verify the real download once, manually, before release.

## Open questions for the user

1. **Names DB scope** — ship all 743k JMnedict entries (131 MB compressed) or subset it (e.g. drop the rarest place names)? Affects whether an opt-in feature is a reasonable download.
2. **Schema version bumping** — manual integer (simple, forgettable) or derived from a hash of `schema.sql` (automatic, but noisy: a comment edit changes the hash)? Recommend manual, with the drift-guard test as the safety net.
3. **Update prompt frequency** — is a once-per-24h check with a dismissible notification the right cadence, or should updates be silent-and-automatic with only a status-bar indication?

## Out of scope

Delta/patch updates (JMdict changes too diffusely to be worth it); a CDN (GitHub Releases have no bandwidth limits); bundling the DB into the .vsix (Marketplace size limits make it impossible); moving the stroke SVGs to downloads (decision 1).
