import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  LATEST_TAG,
  SCHEMA_VERSION,
  releaseTagFor,
  releaseTagsFor
} from "../schema";

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
 * Versions 2 to 5 have no hash: before the first publish the schema churned freely, with no installed
 * version to protect. The guard covers every version from the first published one.
 *
 * When you change the schema:
 *   1. bump `SCHEMA_VERSION` in ../schema.ts,
 *   2. add an entry here mapping the new version to the new hash (printed on failure).
 */
const SCHEMA_HASHES: Record<number, string> = {
  1: "49b815435b1c868efd3b09e5a4691413dbe8f7d8a3def4d1e2603114264b5197",
  6: "ea869126abcd3b0cd3e6d643ab1b498f47cfc7456a6ecc479a425771877050b4",
  7: "433fcce6aab35b4c329d8ee9e1438d8db095925a409dbacd9d5bf7006485e2d3",
  8: "44f84000b76f7b33cd127b061271f4d1dd797571dcb036104bae17a9a0db01f6",
  9: "e889161dbe73469e57ba7da621606c7b7caa926054ab609d3ae0a60108e63078"
};

/** The schema the first published versions (0.1 to 0.3) shipped with. Pinned from here on. */
const FIRST_PUBLISHED_SCHEMA = 6;

const schemaSql = (): string =>
  readFileSync(
    fileURLToPath(new URL("../../data/schema.sql", import.meta.url)),
    "utf8"
  );

describe("schema drift guard", () => {
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

  it("has a pinned hash for every published version up to the current one", () => {
    // Guards against silently dropping an old mapping; the history stays intact.
    const missing: number[] = [];
    for (let v = FIRST_PUBLISHED_SCHEMA; v <= SCHEMA_VERSION; v++) {
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

describe("release tags", () => {
  it("publishes each schema to its own tag", () => {
    // WHY: a schema change must publish BESIDE the data installed versions read, never over it.
    // One tag per schema is what lets a schema change merge without changing what any published
    // version downloads.
    expect(releaseTagsFor(7)).toEqual([releaseTagFor(7)]);
    expect(releaseTagFor(7)).not.toBe(releaseTagFor(8));
  });

  it("keeps refreshing dictionary-latest for schema 6, and only schema 6", () => {
    // WHY: 0.1 to 0.3 download `dictionary-latest` and require schema 6. A schema-6 refresh must
    // still reach them; any other schema there would break every one of them.
    expect(releaseTagsFor(6)).toContain(LATEST_TAG);
    expect(releaseTagsFor(5)).not.toContain(LATEST_TAG);
    expect(releaseTagsFor(7)).not.toContain(LATEST_TAG);
  });
});
