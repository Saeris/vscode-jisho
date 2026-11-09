/**
 * Which dictionaries the data workflow builds, and from which code.
 *
 * Every published version downloads the dictionary of the schema it was built for, from that
 * schema's own release tag (`releaseTagFor`). So every schema that a published version reads has to
 * keep being built: a content refresh must reach 0.3.x as well as the newest release. Only code that
 * builds a schema can build it, so each schema is built from the NEWEST code that reads it — the
 * current commit for its own schema, and the newest published release for every other.
 *
 * Derived from the release tags, so there is no list to keep: tagging a release is what adds its
 * schema to the set.
 */
import { execFileSync } from "node:child_process";
import { releaseTagsFor } from "../src/shared/schema.ts";

/** A published release and the schema its dictionary has. */
export interface Release {
  /** The release's git tag, `vscode-jisho@0.3.0`. */
  tag: string;
  schema: number;
}

/** One dictionary to build: a schema, the code that builds it, and the tags it publishes to. */
export interface DataBuild {
  schema: number;
  /** A git ref — a release tag, or the current commit. */
  ref: string;
  /** Space-separated, for the workflow's shell loop. */
  tags: string;
}

/** `x.y.z` from `vscode-jisho@x.y.z`, as numbers. */
const versionOf = (tag: string): number[] =>
  tag
    .slice(tag.lastIndexOf("@") + 1)
    .split(".")
    .map(Number);

const byVersion = (a: Release, b: Release): number => {
  const [x, y] = [versionOf(a.tag), versionOf(b.tag)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * The dictionaries to build, oldest schema first.
 *
 * `all` builds every schema a published release reads, for a content refresh. `current` builds only
 * the current commit's schema, for a push that changed it: the code that builds the others did not
 * change.
 */
export const dataBuilds = (
  releases: Release[],
  current: { schema: number; ref: string },
  scope: "all" | "current"
): DataBuild[] => {
  const refs = new Map<number, string>();
  if (scope === "all") {
    // Oldest first, so the newest release of each schema is the one left in the map.
    for (const r of releases.toSorted(byVersion)) refs.set(r.schema, r.tag);
  }
  // The current commit is the newest code for its own schema, released or not.
  refs.set(current.schema, current.ref);
  return [...refs]
    .toSorted(([a], [b]) => a - b)
    .map(([schema, ref]) => ({
      schema,
      ref,
      tags: releaseTagsFor(schema).join(" ")
    }));
};

/** The `SCHEMA_VERSION` a copy of `src/shared/schema.ts` declares. */
export const schemaOfSource = (source: string): number | undefined => {
  const match = /export const SCHEMA_VERSION = (\d+);/u.exec(source);
  return match ? Number(match[1]) : undefined;
};

/**
 * Every published release and its schema, read from git: the release tags, and `schema.ts` at each.
 * Needs the tags fetched (`fetch-depth: 0` in a workflow).
 */
export const publishedReleases = (): Release[] => {
  const git = (...args: string[]): string =>
    execFileSync("git", args, { encoding: "utf8" });
  return git("tag", "--list", "vscode-jisho@*")
    .split("\n")
    .filter((tag) => tag !== "")
    .map((tag) => {
      const schema = schemaOfSource(git("show", `${tag}:src/shared/schema.ts`));
      // Loud rather than skipped: a release whose schema cannot be read is a release whose users
      // would silently stop getting dictionary refreshes.
      if (schema === undefined) {
        throw new Error(`Cannot read SCHEMA_VERSION at ${tag}.`);
      }
      return { tag, schema };
    });
};
