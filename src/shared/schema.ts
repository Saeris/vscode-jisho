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
 * (a new/renamed/dropped table or column). The drift-guard test will remind you.
 */
export const SCHEMA_VERSION = 1;

/** The `meta` table key the build writes and the host reads the schema version from. */
export const SCHEMA_VERSION_KEY = "schemaVersion";
