/**
 * Print the data workflow's build matrix: one JSON entry per dictionary to build.
 *
 *   vp exec node scripts/data-matrix.ts            # every schema a published release reads
 *   vp exec node scripts/data-matrix.ts --current  # only this commit's schema
 *
 * See `data-builds.ts` for which code builds which schema. The current commit is `GITHUB_SHA` in a
 * workflow, `HEAD` elsewhere.
 */
import { SCHEMA_VERSION } from "../src/shared/schema.ts";
import { dataBuilds, publishedReleases } from "./data-builds.ts";

const scope = process.argv.includes("--current") ? "current" : "all";
const builds = dataBuilds(
  scope === "all" ? publishedReleases() : [],
  { schema: SCHEMA_VERSION, ref: process.env.GITHUB_SHA ?? "HEAD" },
  scope
);
console.log(JSON.stringify(builds));
