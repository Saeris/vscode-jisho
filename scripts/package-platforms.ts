/**
 * Build one platform-specific .vsix per supported target, all from a single machine.
 *
 * Each .vsix must contain exactly its target's `@tursodatabase` native binary (a 13MB .node
 * addon). Those binaries ship as prebuilt npm packages, so no native toolchain is needed: for
 * each target this script fetches the matching package tarball from the npm registry, swaps it
 * into node_modules/@tursodatabase/ (removing the other platform packages), and runs
 * `vsce package --no-yarn --target <t>`. Original platform packages are restored afterwards.
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
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE_DIR = join(root, "node_modules", "@tursodatabase");
const OUT_DIR = join(root, "dist-vsix");
const BACKUP_DIR = join(root, ".platform-pkgs.tmp");

/**
 * vsce --target → @tursodatabase platform package. Only targets turso actually ships binaries
 * for — notably there is NO darwin-x64 (Intel Mac) build as of 0.6.1, so that platform can't be
 * supported yet. Each entry is validated against the package's optionalDependencies at runtime
 * so a turso upgrade that renames/drops a binary fails loudly here rather than 404ing mid-fetch.
 */
const TARGETS: ReadonlyArray<readonly [target: string, pkg: string]> = [
  ["win32-x64", "database-win32-x64-msvc"],
  ["darwin-arm64", "database-darwin-arm64"],
  ["linux-x64", "database-linux-x64-gnu"],
  ["linux-arm64", "database-linux-arm64-gnu"]
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
  pkg: string,
  version: string
): Promise<void> => {
  const dest = join(SCOPE_DIR, pkg);
  if (existsSync(dest)) return; // already present (the host machine's own platform)
  const url = `https://registry.npmjs.org/@tursodatabase/${pkg}/-/${pkg}-${version}.tgz`;
  console.log(`  fetching ${pkg}@${version}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  untarTo(dest, new Uint8Array(await res.arrayBuffer()));
};

const vsce = (target: string, outFile: string): void => {
  execFileSync(
    "vp",
    ["exec", "vsce", "package", "--no-yarn", "--target", target, "-o", outFile],
    { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
  );
};

const main = async (): Promise<void> => {
  const manifest = readJson(join(root, "package.json"));
  const turso = readJson(join(SCOPE_DIR, "database", "package.json"));
  const binaryVersion = turso.version;
  const shipped = new Set(
    Object.keys(turso.optionalDependencies ?? {}).map((name) =>
      name.replace("@tursodatabase/", "")
    )
  );
  for (const [target, pkg] of TARGETS) {
    if (!shipped.has(pkg)) {
      throw new Error(
        `@tursodatabase/database@${binaryVersion} does not ship ${pkg} (needed for ${target}) — update TARGETS.`
      );
    }
  }

  // Back up the platform packages currently installed, then work from a clean slate so each
  // .vsix contains exactly one platform binary.
  const platformPkgs = new Set(TARGETS.map(([, pkg]) => pkg));
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  mkdirSync(BACKUP_DIR, { recursive: true });
  for (const entry of readdirSync(SCOPE_DIR)) {
    if (platformPkgs.has(entry)) {
      cpSync(join(SCOPE_DIR, entry), join(BACKUP_DIR, entry), {
        recursive: true
      });
      rmSync(join(SCOPE_DIR, entry), { recursive: true, force: true });
    }
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  try {
    for (const [target, pkg] of TARGETS) {
      console.log(`\n── ${target} ──`);
      await fetchPlatformPackage(pkg, binaryVersion);
      const outFile = join(
        OUT_DIR,
        `vscode-jisho-${target}-${manifest.version}.vsix`
      );
      vsce(target, outFile);
      rmSync(join(SCOPE_DIR, pkg), { recursive: true, force: true });
    }
  } finally {
    // Restore whatever was installed before we started.
    for (const entry of readdirSync(BACKUP_DIR)) {
      cpSync(join(BACKUP_DIR, entry), join(SCOPE_DIR, entry), {
        recursive: true
      });
    }
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  }

  console.log(`\nWrote ${TARGETS.length} platform packages to ${OUT_DIR}`);
};

await main();
