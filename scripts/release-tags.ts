/**
 * Print the release tags a built dictionary is published to, one per line.
 *
 *   vp exec node scripts/release-tags.ts assets/jisho-full.db.zst.version
 *
 * Run by the data workflow before it uploads. Reads the BUILT artifact's sidecar, which is what
 * installs will read, and refuses a dictionary whose schema it cannot read or that is not the schema
 * this checkout builds. See `releaseTagsFor` for which tags, and why `dictionary-latest` is frozen.
 */
import { readFileSync } from "node:fs";
import {
  SCHEMA_VERSION,
  releaseTagsFor,
  schemaOfVersion
} from "../src/shared/schema.ts";

const sidecar = process.argv.at(2);
if (sidecar === undefined) {
  console.error("usage: release-tags.ts <path to a .zst.version sidecar>");
  process.exit(2);
}
const version = readFileSync(sidecar, "utf8").trim();
const schema = schemaOfVersion(version);
if (schema !== SCHEMA_VERSION) {
  console.error(
    `Refusing to publish: the built dictionary is schema ${schema ?? "(unknown)"}, but this checkout ` +
      `builds schema ${SCHEMA_VERSION}. Sidecar: "${version}"`
  );
  process.exit(1);
}
for (const tag of releaseTagsFor(schema)) console.log(tag);
