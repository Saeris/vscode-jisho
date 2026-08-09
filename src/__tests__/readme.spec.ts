/**
 * The README against the manifest.
 *
 * The README is the Marketplace listing, and its settings and commands tables RESTATE
 * `package.json`. A restatement drifts the moment the source changes, and nothing about that
 * drift is visible: the listing keeps rendering, it just documents a default nobody ships.
 *
 * These are the checks that need no browser — pure data, so they run in the default suite and
 * catch manifest drift at the moment it happens. The claims that need a running extension live in
 * `e2e/docs/claims.docs.e2e.ts`. See docs/specs/19-documentation-drift-tests.md.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const manifest: {
  contributes: {
    commands: { command: string; category?: string; title: string }[];
    configuration: {
      properties: Record<string, { default?: unknown }>;
    };
  };
} = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * Commands the manual deliberately leaves out, with the reason.
 *
 * An escape hatch is required rather than a concession. `Show Startup Trace` is a diagnostic for
 * debugging activation time and has no place in a user manual — and a check that cannot express
 * that gets suppressed wholesale the first time it fires, after which it guards nothing. Listing it
 * here makes the omission a reviewable decision instead of an oversight.
 */
const UNDOCUMENTED_COMMANDS = new Set([
  "vscode-jisho.showStartupTrace" // diagnostic; for bug reports, not for users
]);

/** `| \`vscode-jisho.x.y\` | \`default\` | …` — the settings table's shape. */
const settingRows = (): Map<string, string> =>
  new Map(
    [
      ...readme.matchAll(/^\|\s*`(vscode-jisho\.[\w.]+)`\s*\|\s*`([^`]*)`/gm)
    ].map((m) => [m[1], m[2]])
  );

/**
 * Command titles the README names in bold, e.g. **Jisho: Look Up Selection**.
 *
 * Filtered to titles carrying a colon-space, which is what separates a command from the
 * extension's own display name ("Jisho: Offline Japanese Dictionary") — that matched the same
 * pattern and read as a command that does not exist.
 */
const documentedCommands = (): Set<string> =>
  new Set(
    [...readme.matchAll(/\*\*(Jisho: [^*]+)\*\*/g)]
      .map((m) => m[1].trim())
      .filter((t) => !t.startsWith("Jisho: Offline"))
  );

describe("rEADME settings table", () => {
  it("documents every setting the extension contributes", () => {
    // WHY: a setting shipped but undocumented is invisible to the reader — the Marketplace listing
    // is the only page they see, so an omission here is the same as the feature not existing.
    const documented = settingRows();
    const missing = Object.keys(
      manifest.contributes.configuration.properties
    ).filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
  });

  it("documents no setting the extension does not contribute", () => {
    // WHY: the other direction. A renamed or removed setting leaves a row telling readers to set
    // something that does nothing, which is worse than saying nothing at all.
    const known = new Set(
      Object.keys(manifest.contributes.configuration.properties)
    );
    const stale = [...settingRows().keys()].filter((key) => !known.has(key));
    expect(stale).toEqual([]);
  });

  it("states each setting's real default", () => {
    // WHY: the defaults are the most quietly-wrong thing in the table. Flipping a default is a
    // one-character manifest edit that no test touches, and the README then tells every reader the
    // opposite of what they will find — `highlighting.enabled` in particular, which the manual
    // explicitly calls out as off by default.
    const documented = settingRows();
    const wrong: string[] = [];
    for (const [key, row] of documented) {
      const actual =
        manifest.contributes.configuration.properties[key]?.default;
      // Compared as the table writes them: `true`, `1.08`, `english` — a JSON string loses its
      // quotes, everything else stringifies as itself.
      const expected =
        typeof actual === "string" ? actual : JSON.stringify(actual);
      if (row !== expected)
        wrong.push(`${key}: README=${row} manifest=${expected}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("rEADME commands table", () => {
  it("documents every command, or declares it deliberately omitted", () => {
    const documented = documentedCommands();
    const missing = manifest.contributes.commands
      .filter((c) => !UNDOCUMENTED_COMMANDS.has(c.command))
      .map((c) => `${c.category ?? ""}: ${c.title}`)
      .filter((title) => !documented.has(title));
    expect(missing).toEqual([]);
  });

  it("names no command that does not exist", () => {
    // WHY: a reader who runs a command from the manual and finds nothing in the palette has been
    // told a falsehood by the most authoritative page there is.
    const known = new Set(
      manifest.contributes.commands.map(
        (c) => `${c.category ?? ""}: ${c.title}`
      )
    );
    const invented = [...documentedCommands()].filter((t) => !known.has(t));
    expect(invented).toEqual([]);
  });
});

describe("rEADME screenshots", () => {
  const referenced = (): string[] => [
    ...new Set(
      [...readme.matchAll(/(?:src|srcset)="(docs\/images\/[\w-]+\.png)"/g)].map(
        (m) => m[1]
      )
    )
  ];

  it("references only images that exist", () => {
    // WHY: a missing image renders as a broken-image icon on the listing page, and the Marketplace
    // fetches from GitHub rather than the package — so this cannot be caught by installing the
    // extension and looking at it.
    const onDisk = new Set(readdirSync(join(root, "docs", "images")));
    const broken = referenced().filter(
      (p) => !onDisk.has(p.replace("docs/images/", ""))
    );
    expect(broken).toEqual([]);
  });

  it("has both themes for every scenario it shows", () => {
    // WHY: the `<picture>` blocks pair a dark `<source>` with a light `<img>`. A half-generated
    // pair means GitHub's dark readers get a broken image while light readers see nothing wrong,
    // which is exactly the kind of asymmetry that survives review.
    const onDisk = new Set(readdirSync(join(root, "docs", "images")));
    const scenarios = new Set(
      referenced().map((p) =>
        p.replace("docs/images/", "").replace(/-(light|dark)\.png$/, "")
      )
    );
    const incomplete = [...scenarios].filter(
      (s) => !onDisk.has(`${s}-light.png`) || !onDisk.has(`${s}-dark.png`)
    );
    expect(incomplete).toEqual([]);
  });

  it("uses every scenario the harness generates", () => {
    // WHY: an unused scenario is a capture the docs run pays for on every invocation and nobody
    // reads. It usually means a section was cut and its image was left behind, so this is the
    // check that keeps `vp run docs:shots` honest about its own cost.
    const generated = new Set(
      readdirSync(join(root, "docs", "images"))
        .filter((f) => f.endsWith(".png"))
        .map((f) => f.replace(/-(light|dark)\.png$/, ""))
    );
    const used = new Set(
      referenced().map((p) =>
        p.replace("docs/images/", "").replace(/-(light|dark)\.png$/, "")
      )
    );
    const unused = [...generated].filter((s) => !used.has(s));
    expect(unused).toEqual([]);
  });
});
