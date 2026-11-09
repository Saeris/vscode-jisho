import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { SCHEMA_FROZEN, SCHEMA_VERSION } from "../schema";

/**
 * Drift guard: the schema shape and its version number must move together.
 *
 * `SCHEMA_VERSION` is bumped by hand (spec 05 §1 — a content hash would churn on every comment
 * edit). The manual step is only reliable if something FORCES it, so this test pins a hash of
 * `schema.sql` PER VERSION. Edit the schema and the hash no longer matches → this test fails →
 * you must bump `SCHEMA_VERSION` and record the new hash below. That is the whole point: a schema
 * change that the host queries against cannot ship without the version the host checks also moving,
 * which is what prevents a version-skewed DB from crashing deep inside a query on a missing column.
 *
 * DORMANT until the schema is frozen: while `SCHEMA_FROZEN` is false the v1 schema is still being
 * developed, so it churns freely and there is no shipped client to protect — the guard is skipped.
 * At the pre-publish lock step, freeze the schema (`SCHEMA_FROZEN = true`) and pin the then-current
 * hash below; from then on the guard is live.
 *
 * When you legitimately change the schema AFTER freezing:
 *   1. bump `SCHEMA_VERSION` in ../schema.ts,
 *   2. add an entry here mapping the new version to the new hash (printed on failure).
 */
const SCHEMA_HASHES: Record<number, string> = {
  1: "49b815435b1c868efd3b09e5a4691413dbe8f7d8a3def4d1e2603114264b5197"
};

const schemaSql = (): string =>
  readFileSync(
    fileURLToPath(new URL("../../data/schema.sql", import.meta.url)),
    "utf8"
  );

// Skipped (not silently passing) while the schema is unfrozen, so the suite output shows the guard
// is intentionally dormant during v1 development rather than absent.
describe.skipIf(!SCHEMA_FROZEN)("schema drift guard", () => {
  it("pins the schema.sql content to the current SCHEMA_VERSION", () => {
    const actual = createHash("sha256").update(schemaSql()).digest("hex");
    const pinned = SCHEMA_HASHES[SCHEMA_VERSION];
    // No pinned hash for the current version → add one to SCHEMA_HASHES.
    expect(pinned).toBeDefined();
    // If `actual` !== `pinned`, schema.sql changed. The fix is NOT to update the hash for the same
    // version — that ships a new shape under an unchanged number and defeats the guard. Instead:
    // bump SCHEMA_VERSION in schema.ts, then add a SCHEMA_HASHES entry mapping it to the `actual`
    // hash shown in the failure diff below.
    expect(actual).toBe(pinned);
  });

  it("has a pinned hash for every version up to the current one", () => {
    // Guards against silently dropping an old mapping; the history stays intact.
    const missing: number[] = [];
    for (let v = 1; v <= SCHEMA_VERSION; v++) {
      if (typeof SCHEMA_HASHES[v] !== "string") missing.push(v);
    }
    expect(missing).toEqual([]);
  });
});

describe("data release sidecars", () => {
  it("reads the schema a release was built for", async () => {
    // WHY: the update check and the data workflow both decide compatibility from this, so a sidecar
    // whose token is misread would either brick installs or block every legitimate update.
    const { schemaOfVersion } = await import("../schema");
    expect(
      schemaOfVersion("full schema6 2026-08-03 2026-08-10T01:14:07.082Z")
    ).toBe(6);
    expect(schemaOfVersion("names schema12 2026-08-03")).toBe(12);
  });

  it("reports an unnamed schema as unknown, never as a number", async () => {
    // WHY: sidecars from before the token existed must read as "unknown" so callers refuse them;
    // NaN or 0 would compare unequal by accident rather than by intent.
    const { schemaOfVersion } = await import("../schema");
    expect(
      schemaOfVersion("full 2026-08-03 2026-08-08T04:22:10.194Z")
    ).toBeUndefined();
  });

  it("keeps dictionary-latest at the schema every published version reads", async () => {
    // WHY: 0.2.x and 0.3.x hardcode `dictionary-latest` and require schema 6 exactly. Changing this
    // constant is the one edit that would let the data workflow break every installed copy, so it is
    // pinned here: a schema change belongs on its own release tag, not on this one.
    const { LATEST_TAG_SCHEMA } = await import("../schema");
    expect(LATEST_TAG_SCHEMA).toBe(6);
  });
});
