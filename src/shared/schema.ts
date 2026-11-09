/**
 * The database schema version — the single source of truth shared by the data build and the
 * extension host.
 *
 * The `.version` sidecar next to a built DB tracks DATA freshness (JMdict date + build timestamp),
 * which is what drives a re-download when the dictionary content updates. This is a different thing:
 * the SHAPE of the database — its tables and columns. If the extension ships expecting a `similar`
 * column the delivered DB doesn't have, every query on it crashes at runtime.
 *
 * So the build stamps this number into the DB's `meta` table (`schemaVersion`), the host checks it
 * when opening, and a drift-guard test (schema.spec.ts) fails CI if `schema.sql` changes without
 * this number being bumped. Manual integer by decision (spec 05 §1): a content hash would churn on
 * a comment edit; the drift-guard test is the safety net that makes the manual step reliable.
 *
 * BUMP THIS whenever `src/data/schema.sql` changes in a way that affects what the host queries
 * (a new/renamed/dropped table or column). Once the schema is FROZEN (see `SCHEMA_FROZEN`), the
 * drift-guard test will remind you.
 */
export const SCHEMA_VERSION = 6;

/**
 * Whether the schema is frozen for release. While the v1 schema is still being developed it churns
 * freely — bumping the version on every pre-release edit would be noise, and v1 hasn't shipped, so
 * there is no installed client to protect yet. The drift-guard test (schema.spec.ts) is therefore
 * DORMANT while this is false.
 *
 * Flip this to `true` as the FINAL step before the first publish (and pin the current schema.sql
 * hash into `SCHEMA_HASHES`). From then on the guard is live: any schema change must bump
 * `SCHEMA_VERSION` and record the new hash, so a shape change can never ship under a version an
 * installed client already trusts.
 */
export const SCHEMA_FROZEN = false;

/** The `meta` table key the build writes and the host reads the schema version from. */
export const SCHEMA_VERSION_KEY = "schemaVersion";

/**
 * The `sentences.sense_position` sentinel for a word-level pooled example (F1): a Tatoeba sentence
 * whose B-line token carried no in-range `[NN]` sense tag is attached to the word, not a sense. The
 * build writes it and the host reads it, so it lives here with the other schema-shape constants.
 */
export const WORD_LEVEL_SENSE = -1;

/**
 * The schema a data release was built for, read from its `.version` sidecar.
 *
 * The sidecar reads `full schema6 2026-08-03 2026-08-10T01:14:07.082Z`. Undefined when the token is
 * missing — sidecars written before it existed — which callers must treat as "unknown", never as a
 * match: offering a database whose shape cannot be checked is how a working install gets replaced
 * by one it refuses to open.
 */
export const schemaOfVersion = (version: string): number | undefined => {
  const match = /\bschema(\d+)\b/u.exec(version);
  return match ? Number(match[1]) : undefined;
};

/**
 * The schema `dictionary-latest` is frozen at, permanently.
 *
 * Every version published so far (0.2.x, 0.3.x) downloads that one tag and requires EXACTLY this
 * schema. Nothing shipped in a later build can protect those installs; only what is uploaded to the
 * tag can. So the tag must never carry another schema — not even a newer one: an installed 0.3.1
 * would download it on first run and refuse to open it, and an existing install's update prompt
 * would replace its working database with that unreadable one. A schema change publishes to its own
 * tag instead (HARDENING-PLAN.md H-8).
 */
export const LATEST_TAG_SCHEMA = 6;
