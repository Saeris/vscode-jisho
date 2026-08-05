/**
 * Provision the Lindera FTS5 tokenizer extension into `assets/lindera-fts5/`.
 *
 * Run occasionally, not per-build:  vp run build:fts-extension
 *
 * EXPERIMENTAL and DEV-ONLY. `lindera-sqlite` exposes a C ABI FTS5 tokenizer, which is what makes
 * Japanese full-text search possible at all: stock FTS5's `unicode61` tokenizer scores ZERO on CJK
 * (verified), because it has no way to find word boundaries in text without spaces.
 *
 * ## Why this builds from a local clone rather than downloading
 *
 * The published `lindera-sqlite` v2.0.0 cannot load into any SQLite >= 3.47 — two bugs on its init
 * path (lindera/lindera-sqlite#34): it binds the fts5_api out-pointer's VALUE instead of its
 * address, and then requires `fts5_api.iVersion == 2` where modern SQLite reports 3. Both are fixed
 * on our fork's `fix/fts5-api-pointer-and-version` branch, which is what the PR proposes upstream.
 *
 * So there is no release asset to fetch yet. This script builds the patched source, which means it
 * needs a Rust toolchain — deliberately NOT a requirement for ordinary development, which is why
 * this is a separate opt-in script rather than part of any build. When upstream merges and releases,
 * this collapses into a plain download (like `build-tokenizer-dict.ts`) and the toolchain
 * requirement disappears.
 *
 * ## Scope
 *
 * WINDOWS x64 ONLY, on purpose. `sqlite3ext-sys` compiles C through `cc`, so the other five targets
 * need full cross-toolchains we do not have locally, and the extension is ~18MB per platform. The
 * host loads it only if the file is present (see `src/host/fts.ts`), so every other platform — and
 * every shipped .vsix — simply keeps today's search behaviour. Nothing regresses if it is absent.
 *
 * The output directory is gitignored: a provisioned build artifact, not source.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "assets", "lindera-fts5");

/**
 * Where the patched `lindera-sqlite` checkout lives. Sibling to this repo by default; override with
 * `LINDERA_SQLITE_PATH` if it is elsewhere.
 */
const SRC =
  process.env.LINDERA_SQLITE_PATH ??
  join(root, "..", "..", "@lindera", "lindera-sqlite");

// Pinned to the dictionary the tokenizer already uses. Matching matters for CONSISTENCY rather than
// correctness here — the FTS index and hover/search should segment text the same way, or a word
// found by one could be missed by the other.
const FEATURES = "embed-ipadic";

const DLL = "lindera_sqlite.dll";

const main = (): void => {
  if (process.platform !== "win32") {
    console.log(
      `Skipping: this script builds the Windows x64 extension only (see the header). Platform: ${process.platform}.`
    );
    return;
  }
  if (!existsSync(SRC)) {
    throw new Error(
      `lindera-sqlite checkout not found at ${SRC}.\n` +
        `Clone https://github.com/Saeris/lindera-sqlite (branch fix/fts5-api-pointer-and-version), ` +
        `or set LINDERA_SQLITE_PATH to an existing checkout.`
    );
  }

  console.log(`Building lindera-sqlite (${FEATURES}) from ${SRC}…`);
  try {
    execFileSync("cargo", ["build", "--release", `--features=${FEATURES}`], {
      cwd: SRC,
      stdio: "inherit",
      env: process.env
    });
  } catch (error) {
    throw new Error(
      `cargo build failed. This script needs a Rust toolchain and libclang ` +
        `(LLVM 20.x — bindgen 0.60, which sqlite3ext-sys uses, emits a broken binding against ` +
        `LLVM 22+; set LIBCLANG_PATH if it is not discovered).`,
      { cause: error }
    );
  }

  const built = join(SRC, "target", "release", DLL);
  if (!existsSync(built)) {
    throw new Error(`Build reported success but ${built} is missing.`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(built, join(OUT_DIR, DLL));

  // The tokenizer reads its filter pipeline from a YAML config at load time (the path comes from
  // LINDERA_CONFIG_PATH). Ship the upstream one next to the binary so the host can point at it
  // without depending on the source checkout still being present.
  const config = join(SRC, "resources", "lindera.yml");
  if (!existsSync(config)) {
    throw new Error(`Expected tokenizer config at ${config}.`);
  }
  copyFileSync(config, join(OUT_DIR, "lindera.yml"));

  writeFileSync(
    join(OUT_DIR, "SOURCE"),
    [
      "lindera-sqlite, built from a patched checkout (lindera/lindera-sqlite#34).",
      `source:   ${SRC}`,
      `features: ${FEATURES}`,
      `built:    ${new Date().toISOString()}`,
      "",
      "Replace with an upstream release asset once the fix is merged.",
      ""
    ].join("\n")
  );

  console.log(`Wrote ${DLL} + lindera.yml to assets/lindera-fts5/.`);
};

main();
