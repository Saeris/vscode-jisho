/**
 * Build one platform-specific .vsix per supported target, all from a single machine.
 *
 * Each .vsix must contain exactly its target's native binary: the `lindera-nodejs` tokenizer addon
 * (~5MB). It ships as prebuilt per-platform npm packages, so no native toolchain is needed: for each
 * target this script fetches the matching package tarball from the npm registry, swaps it into
 * node_modules/ (removing the other platforms'), and runs `vsce package --no-yarn --target <t>`.
 * Originals are restored afterwards.
 *
 * The database used to be a second native dependency (`@tursodatabase`, ~13MB per target). It is now
 * Node's built-in `node:sqlite`, so it needs no packaging at all — which both shrinks every .vsix
 * and widened the target list (see TARGETS).
 *
 * Run after `vp pack && vp build` (the JS artifacts are platform-independent):
 *   vp exec node scripts/package-platforms.ts
 * Output: dist-vsix/vscode-jisho-<target>-<version>.vsix
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULES_DIR = join(root, "node_modules");
const OUT_DIR = join(root, "dist-vsix");
const BACKUP_DIR = join(root, ".platform-pkgs.tmp");

/**
 * A native dependency whose per-platform binary must be swapped so each .vsix carries exactly one.
 * `dir` is where its platform packages live (a scope dir for turso, node_modules itself for the
 * unscoped lindera packages); `registry` is the npm path used to fetch a tarball; `versionPkg`
 * points at the package.json whose version + optionalDependencies pin the platform set; `pkgFor`
 * maps a vsce target to that dependency's platform-package name.
 */
interface NativeDep {
  readonly name: string;
  readonly dir: string;
  readonly registry: (pkg: string, version: string) => string;
  readonly versionPkg: string;
  readonly pkgFor: Record<string, string>;
}

// vsce --target list. The tokenizer is now the ONLY native dependency — the database is Node's
// built-in `node:sqlite` — so this is exactly what lindera-nodejs ships. That is what restored
// darwin-x64 (Intel Mac) and win32-arm64: the old list was capped at four targets because
// @tursodatabase had no build for either.
const TARGETS = [
  "win32-x64",
  "win32-arm64",
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64"
] as const;

const NATIVE_DEPS: readonly NativeDep[] = [
  {
    name: "lindera-nodejs",
    dir: MODULES_DIR,
    registry: (pkg, version) =>
      `https://registry.npmjs.org/${pkg}/-/${pkg}-${version}.tgz`,
    versionPkg: join(MODULES_DIR, "lindera-nodejs", "package.json"),
    pkgFor: {
      "win32-x64": "lindera-nodejs-win32-x64-msvc",
      "win32-arm64": "lindera-nodejs-win32-arm64-msvc",
      "darwin-x64": "lindera-nodejs-darwin-x64",
      "darwin-arm64": "lindera-nodejs-darwin-arm64",
      "linux-x64": "lindera-nodejs-linux-x64-gnu",
      "linux-arm64": "lindera-nodejs-linux-arm64-gnu"
    }
  }
];

interface PackageManifest {
  version: string;
  optionalDependencies?: Record<string, string>;
}

const readJson = (path: string): PackageManifest => {
  const data: PackageManifest = JSON.parse(readFileSync(path, "utf8"));
  return data;
};

/** Extract every regular file of a .tgz (npm tarballs prefix entries with "package/"). */
const untarTo = (destDir: string, tgz: Uint8Array): void => {
  const tar = gunzipSync(tgz);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const nul = header.indexOf(0);
    const name = Buffer.from(
      header.subarray(0, nul === -1 ? 100 : Math.min(nul, 100))
    )
      .toString("utf8")
      .trim();
    if (name === "") break;
    const size = parseInt(
      Buffer.from(header.subarray(124, 136)).toString("utf8").trim(),
      8
    );
    const type = String.fromCharCode(header[156]);
    const contentStart = offset + 512;
    if ((type === "0" || type === "\0") && name.startsWith("package/")) {
      const rel = name.slice("package/".length);
      const outPath = join(destDir, rel);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, tar.subarray(contentStart, contentStart + size));
    }
    offset = contentStart + Math.ceil((size || 0) / 512) * 512;
  }
};

const fetchPlatformPackage = async (
  dep: NativeDep,
  pkg: string,
  version: string
): Promise<void> => {
  const dest = join(dep.dir, pkg);
  if (existsSync(dest)) return; // already present (the host machine's own platform)
  const url = dep.registry(pkg, version);
  console.log(`  fetching ${pkg}@${version}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  untarTo(dest, new Uint8Array(await res.arrayBuffer()));
};

/**
 * The stroke-SVG directories, whose filenames are the characters they draw.
 *
 * Readable on disk — `assets/kanji-svgs/水.svg` is greppable and obvious — and NOT shippable. The
 * 0.1.0 publish was rejected by the Marketplace with "Item has already been added. Key in
 * dictionary: 'extension/assets/kana-svgs/….svg'": its ingestion keys entries in a
 * case-insensitive .NET dictionary, and two distinct kana folded onto one key there.
 *
 * The fold is not reproducible locally — `vsce package` emits correct UTF-8 entry names with no
 * duplicates under NFC, NFKC or case folding — so this does not try to find the offending pairs. It
 * removes the possibility: inside the .vsix every drawing is named by its decimal codepoint, which
 * is pure ASCII and cannot collide under any normalization, case fold or filesystem encoding.
 * (Decimal because that is what upstream AnimCJK serves, so the shipped name matches its source.)
 *
 * Renamed only for packaging, then restored — `#strokeSvg` derives the same codepoint name when it
 * reads, so the extension resolves the shipped files while the repository keeps its readable ones.
 */
const SVG_DIRS = ["kanji-svgs", "kana-svgs"] as const;

/** Rename every drawing to `<codepoint>.svg`, returning the moves so they can be undone. */
const toCodepointNames = (): Array<{ from: string; to: string }> => {
  const moves: Array<{ from: string; to: string }> = [];
  for (const dirName of SVG_DIRS) {
    const dir = join(root, "assets", dirName);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".svg")) continue;
      const literal = entry.slice(0, -".svg".length);
      const codepoint = literal.codePointAt(0);
      // Already numeric, or not a single character: leave it alone rather than guess.
      if (codepoint === undefined || /^[0-9]+$/u.test(literal)) continue;
      if (Array.from(literal).length !== 1) continue;
      const from = join(dir, entry);
      const to = join(dir, `${codepoint}.svg`);
      renameSync(from, to);
      moves.push({ from, to });
    }
  }
  return moves;
};

const vsce = (target: string, outFile: string): void => {
  execFileSync(
    "vp",
    ["exec", "vsce", "package", "--no-yarn", "--target", target, "-o", outFile],
    { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
  );
};

/** Resolve each native dep's pinned version + validate it ships every target we package. */
const resolveDeps = (): ReadonlyArray<{ dep: NativeDep; version: string }> =>
  NATIVE_DEPS.map((dep) => {
    const manifest = readJson(dep.versionPkg);
    const version = manifest.version;
    // optionalDependencies list the platform packages; strip any scope so both naming styles match.
    const shipped = new Set(
      Object.keys(manifest.optionalDependencies ?? {}).map((name) =>
        name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name
      )
    );
    for (const target of TARGETS) {
      // pkgFor is exhaustive over TARGETS by construction; if a future dep omits one, `shipped.has`
      // below still catches it (undefined is never in the shipped set).
      const pkg = dep.pkgFor[target];
      if (!shipped.has(pkg)) {
        throw new Error(
          `${dep.name}@${version} does not ship ${pkg} (needed for ${target}) — update NATIVE_DEPS.`
        );
      }
    }
    return { dep, version };
  });

/** A backup slot per dep, so restore can put each platform package back under its own dir. */
const backupSlot = (depName: string): string =>
  join(BACKUP_DIR, depName.replace("/", "__"));

const main = async (): Promise<void> => {
  // .vscodeignore un-ignores assets/lindera-ipadic, but a negation matches nothing when the
  // directory is absent — so without this the package would build clean and ship a tokenizer that
  // cannot load its dictionary. Provisioning is deliberately explicit (like build:data), so demand
  // it rather than run it here.
  if (!existsSync(join(root, "assets", "lindera-ipadic", "dict.da"))) {
    throw new Error(
      "assets/lindera-ipadic/ is missing — run `vp run build:tokenizer-dict` before packaging."
    );
  }
  const manifest = readJson(join(root, "package.json"));
  const deps = resolveDeps();

  // Back up the platform packages currently installed (per dep), then work from a clean slate so
  // each .vsix contains exactly one platform binary per dep.
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  mkdirSync(BACKUP_DIR, { recursive: true });

  // Stage the stroke drawings under ASCII names for the duration of packaging. Inside the try so a
  // failed target cannot leave the working tree renamed; see `toCodepointNames` for why.
  let svgMoves: Array<{ from: string; to: string }> = [];
  for (const { dep } of deps) {
    const platformPkgs = new Set(Object.values(dep.pkgFor));
    const slot = backupSlot(dep.name);
    mkdirSync(slot, { recursive: true });
    for (const entry of readdirSync(dep.dir)) {
      if (platformPkgs.has(entry)) {
        cpSync(join(dep.dir, entry), join(slot, entry), { recursive: true });
        rmSync(join(dep.dir, entry), { recursive: true, force: true });
      }
    }
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  try {
    svgMoves = toCodepointNames();
    console.log(
      `  staged ${svgMoves.length} stroke SVGs under codepoint names`
    );
    for (const target of TARGETS) {
      console.log(`\n── ${target} ──`);
      // Install exactly this target's binary for every native dep.
      for (const { dep, version } of deps) {
        await fetchPlatformPackage(dep, dep.pkgFor[target], version);
      }
      const outFile = join(
        OUT_DIR,
        `vscode-jisho-${target}-${manifest.version}.vsix`
      );
      vsce(target, outFile);
      // Remove this target's binaries before the next target installs its own.
      for (const { dep } of deps) {
        rmSync(join(dep.dir, dep.pkgFor[target]), {
          recursive: true,
          force: true
        });
      }
    }
  } finally {
    // Put the readable SVG filenames back, whatever happened.
    for (const { from, to } of svgMoves) renameSync(to, from);
    // Restore whatever was installed before we started, per dep.
    for (const { dep } of deps) {
      const slot = backupSlot(dep.name);
      for (const entry of readdirSync(slot)) {
        cpSync(join(slot, entry), join(dep.dir, entry), { recursive: true });
      }
    }
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  }

  console.log(
    `\nWrote ${TARGETS.length} platform packages to ${OUT_DIR} (${deps.map((d) => d.dep.name).join(" + ")})`
  );
};

await main();
