import { describe, expect, it } from "vite-plus/test";
import { dataBuilds, schemaOfSource, type Release } from "../data-builds";

const releases: Release[] = [
  { tag: "vscode-jisho@0.1.0", schema: 6 },
  // Out of order on purpose: git lists tags alphabetically, so 0.10 sorts before 0.9.
  { tag: "vscode-jisho@0.10.0", schema: 7 },
  { tag: "vscode-jisho@0.3.0", schema: 6 },
  { tag: "vscode-jisho@0.9.0", schema: 7 }
];

describe("which dictionaries the data workflow builds", () => {
  it("keeps building every schema a published release reads", () => {
    // WHY: each published version downloads its own schema's dictionary. A refresh that rebuilt
    // only the newest schema would leave everyone on an older version with stale data — and with
    // nothing at all, once that schema's release is lost or broken.
    const builds = dataBuilds(releases, { schema: 8, ref: "abc123" }, "all");
    expect(builds.map((b) => b.schema)).toEqual([6, 7, 8]);
  });

  it("builds each older schema from the newest release that reads it", () => {
    // WHY: only code that builds a schema can build it, and the newest such code carries every fix
    // made while that schema was current. Versions compare as numbers: 0.10.0 is newer than 0.9.0.
    const builds = dataBuilds(releases, { schema: 8, ref: "abc123" }, "all");
    expect(builds.find((b) => b.schema === 6)?.ref).toBe("vscode-jisho@0.3.0");
    expect(builds.find((b) => b.schema === 7)?.ref).toBe("vscode-jisho@0.10.0");
  });

  it("builds the current schema from the current commit, released or not", () => {
    // WHY: the current commit is the newest code for its schema. Building a released schema from
    // the old release instead would undo every fix made since.
    const builds = dataBuilds(releases, { schema: 7, ref: "abc123" }, "all");
    expect(builds.find((b) => b.schema === 7)?.ref).toBe("abc123");
  });

  it("rebuilds only the current schema for a push", () => {
    // WHY: a push changed the current schema's build; the code that builds the others did not.
    expect(
      dataBuilds(releases, { schema: 8, ref: "abc123" }, "current")
    ).toEqual([{ schema: 8, ref: "abc123", tags: "dictionary-v8" }]);
  });

  it("publishes schema 6 to dictionary-latest as well as its own tag", () => {
    // WHY: 0.1 to 0.3 download `dictionary-latest`. Their refreshes must still land there.
    const builds = dataBuilds(releases, { schema: 7, ref: "abc123" }, "all");
    expect(builds.find((b) => b.schema === 6)?.tags).toBe(
      "dictionary-v6 dictionary-latest"
    );
    expect(builds.find((b) => b.schema === 7)?.tags).toBe("dictionary-v7");
  });
});

describe("reading a release's schema", () => {
  it("reads SCHEMA_VERSION from a copy of schema.ts", () => {
    // WHY: this is how each release tag's schema is learned. A misread would build the wrong code
    // for a schema, or drop a schema that installed versions still read.
    expect(schemaOfSource("export const SCHEMA_VERSION = 6;\n")).toBe(6);
    expect(schemaOfSource("export const OTHER = 6;\n")).toBeUndefined();
  });
});
