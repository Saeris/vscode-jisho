/**
 * Refuse to publish a dictionary to `dictionary-latest` unless it is the schema that tag is frozen at.
 *
 *   vp exec node scripts/check-latest-schema.ts assets/jisho-full.db.zst.version
 *
 * Run by the data workflow before it uploads. See `LATEST_TAG_SCHEMA` for why the tag is frozen: every
 * published version hardcodes it, so a different schema there breaks installs no code change can reach.
 */
import { readFileSync } from "node:fs";
import { LATEST_TAG_SCHEMA, schemaOfVersion } from "../src/shared/schema.ts";

const sidecar = process.argv.at(2);
if (sidecar === undefined) {
  console.error(
    "usage: check-latest-schema.ts <path to a .zst.version sidecar>"
  );
  process.exit(2);
}
const version = readFileSync(sidecar, "utf8").trim();
const schema = schemaOfVersion(version);
if (schema !== LATEST_TAG_SCHEMA) {
  console.error(
    `Refusing to publish schema ${schema ?? "(unknown)"} to dictionary-latest, which is frozen at schema ${LATEST_TAG_SCHEMA}.\n` +
      `Every published version (0.2.x, 0.3.x) downloads that tag and requires schema ${LATEST_TAG_SCHEMA} exactly, so another\n` +
      `schema there breaks every installed copy. A schema change must publish to its own tag — see\n` +
      `docs/HARDENING-PLAN.md (H-8). Sidecar: "${version}"`
  );
  process.exit(1);
}
console.log(`dictionary-latest accepts this build: schema ${schema}.`);
