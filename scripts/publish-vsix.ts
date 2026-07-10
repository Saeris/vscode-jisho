/**
 * Publish every platform .vsix built by package-platforms.ts to the VS Code Marketplace and
 * Open VSX. Run by Bumpy's publishCommand on release (needs VSCE_PAT / OVSX_PAT in the env).
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
  const path = join(OUT_DIR, file);
  run("vsce", ["publish", "--no-yarn", "--packagePath", path]);
  run("ovsx", ["publish", path]);
}
console.log(`Published ${packages.length} platform packages.`);
