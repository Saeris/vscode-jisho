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
 * BUMP THIS whenever `src/data/schema.sql` changes, and record the new hash in schema.spec.ts — the
 * drift-guard test fails until you do. The schema churned freely before the first publish; since
 * then installed versions depend on it, so a shape change must never ship under a version one of
 * them already trusts. A new version also publishes to a new release tag (`releaseTagFor`).
 */
export const SCHEMA_VERSION = 6;

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

/** The rolling tag that every version built for schema 6 downloads. See `LATEST_TAG_SCHEMA`. */
export const LATEST_TAG = "dictionary-latest";

/**
 * The release tag a schema's dictionaries are published to, and downloaded from: `dictionary-v7`.
 *
 * One tag per schema, so a schema change publishes BESIDE the data that installed versions read,
 * not over it. Each version downloads the tag of the schema it was built for, and nothing uploaded
 * for another schema can reach it. Content refreshes go to the same tag, so they still arrive
 * without an extension release.
 */
export const releaseTagFor = (schema: number): string =>
  `dictionary-v${schema}`;

/**
 * Every tag a dictionary built for `schema` is published to: its own, and `dictionary-latest` as
 * well when that is the schema the tag is frozen at, so the versions that read it keep getting
 * content refreshes.
 */
export const releaseTagsFor = (schema: number): string[] =>
  schema === LATEST_TAG_SCHEMA
    ? [releaseTagFor(schema), LATEST_TAG]
    : [releaseTagFor(schema)];
