/**
 * Publish every platform .vsix built by package-platforms.ts to the VS Code Marketplace. Run by
 * Bumpy's publishCommand on release (needs VSCE_PAT in the env).
 *
 * Marketplace only, deliberately: v1 targets the editor the extension was built and tested in.
 * Open VSX is a separate distribution story — a second registry, its own token and namespace
 * claim, and editors (VSCodium, Cursor, Gitpod) none of which are part of the release test. It was
 * dropped rather than shipped untested; see docs/ROADMAP.md.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "dist-vsix");

const run = (cmd: string, args: string[]): void => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync("vp", ["exec", cmd, ...args], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
};

const packages = readdirSync(OUT_DIR).filter((f) => f.endsWith(".vsix"));
if (packages.length === 0) {
  throw new Error(
    `No .vsix packages found in ${OUT_DIR} — run package-platforms first.`
  );
}

for (const file of packages) {
  run("vsce", ["publish", "--no-yarn", "--packagePath", join(OUT_DIR, file)]);
}
console.log(`Published ${packages.length} platform packages.`);
