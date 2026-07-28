/**
 * Loader shim for `lindera-nodejs` (NAPI native binding).
 *
 * WHY THIS EXISTS: the published `lindera-nodejs` npm package is broken — its tarball ships only
 * `package.json` + `README.md`, missing the napi-generated `index.js` entry point that resolves the
 * per-platform `.node` binary (upstream release-workflow bug: the publish job never runs `napi build`
 * to emit it; filed upstream 2026-07-27). The platform packages (`lindera-nodejs-<platform>`) DO ship
 * their `.node` and export the full API, so this shim reconstructs the missing loader: detect the
 * runtime platform, `require` the matching platform package, and re-export it.
 *
 * Drop this shim (and the direct platform-package deps in package.json) once upstream publishes a
 * working `lindera-nodejs` with its entry point intact. Tracked in docs/specs/14.
 *
 * This is the CJS half; `index.mjs` re-exports it so our ESM code (`tokenizer.ts`) imports cleanly
 * without a `createRequire` dance (the published package's require-only exports map forces that;
 * we deliberately don't repeat the mistake — see spec 14).
 */

// Map the running platform to its `lindera-nodejs-<platform>` package, mirroring napi-rs's own
// generated resolution. Linux distinguishes glibc (`-gnu`) from musl (`-musl`); lindera currently
// ships only `-gnu` binaries, so musl is unsupported and reported as such rather than silently wrong.
function platformPackage() {
  const { platform, arch } = process;
  if (platform === "win32") {
    if (arch === "x64") return "lindera-nodejs-win32-x64-msvc";
    if (arch === "arm64") return "lindera-nodejs-win32-arm64-msvc";
  } else if (platform === "darwin") {
    if (arch === "x64") return "lindera-nodejs-darwin-x64";
    if (arch === "arm64") return "lindera-nodejs-darwin-arm64";
  } else if (platform === "linux") {
    const musl = isMusl();
    if (arch === "x64") {
      if (musl) return null; // no musl build published
      return "lindera-nodejs-linux-x64-gnu";
    }
    if (arch === "arm64") {
      if (musl) return null;
      return "lindera-nodejs-linux-arm64-gnu";
    }
  }
  return null;
}

/** Best-effort glibc-vs-musl detection (report.header.glibcVersionRuntime is present on glibc). */
function isMusl() {
  try {
    const report = process.report?.getReport();
    const header =
      typeof report === "string" ? JSON.parse(report).header : report?.header;
    return !header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

const pkg = platformPackage();
if (pkg === null) {
  throw new Error(
    `lindera-nodejs: no prebuilt binary for ${process.platform}/${process.arch}${process.platform === "linux" ? " (musl libc is not supported)" : ""}`
  );
}

let binding;
try {
  // The dynamic require IS the point — a platform loader resolves the binary at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-dynamic-require
  binding = require(pkg);
} catch (cause) {
  throw new Error(
    `lindera-nodejs: failed to load platform package "${pkg}". Is it installed for this platform?`,
    { cause }
  );
}

module.exports = binding;
