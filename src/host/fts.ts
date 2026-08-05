/**
 * Optional Japanese full-text search, via the Lindera FTS5 tokenizer extension.
 *
 * EXPERIMENTAL. Everything here is gated on the extension being present on disk
 * (`assets/lindera-fts5/`), which it is only after `vp run build:fts-extension` — a manual,
 * Windows-only, Rust-requiring step. When it is absent, which is the case for every shipped
 * `.vsix` today, `loadFtsTokenizer` reports `false` and callers keep using the existing
 * `search_terms` path. Nothing regresses; there is simply no `lindera_tokenizer` to build an FTS5
 * table with.
 *
 * WHY it is worth having at all: stock FTS5's `unicode61` tokenizer scores ZERO on Japanese
 * (verified) — Japanese has no spaces, so a tokenizer that splits on them finds no word boundaries.
 * Lindera does the morphological analysis, which is what makes MATCH work on CJK text.
 *
 * WHY it is not enabled yet: the published extension cannot load into modern SQLite
 * (lindera/lindera-sqlite#34), so this consumes a locally-built patched copy. Once that is merged
 * and released, provisioning becomes a download and this gate can become a normal capability check.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** Where `build-fts-extension.ts` provisions the extension. */
const dirFor = (extensionRoot: string): string =>
  join(extensionRoot, "assets", "lindera-fts5");

/** The platform-specific loadable-extension filename. Windows-only for now, by construction. */
const LIBRARY = "lindera_sqlite.dll";

/** The exported symbol SQLite must call — NOT the default `sqlite3_extension_init`. */
const ENTRY_POINT = "lindera_fts5_tokenizer_init";

/** Whether the FTS tokenizer has been provisioned for this install. */
export const ftsExtensionAvailable = (extensionRoot: string): boolean =>
  existsSync(join(dirFor(extensionRoot), LIBRARY));

/**
 * Register the `lindera_tokenizer` FTS5 tokenizer on a connection, returning whether it is usable.
 *
 * Best-effort by design: a missing or unloadable extension is a normal, expected state (no Rust
 * toolchain, wrong platform, upstream still unfixed), not an error worth failing activation over.
 * Callers branch on the boolean rather than catching.
 *
 * The connection must have been opened with `allowExtension: true`; a read-only dictionary
 * connection is fine, since registering a tokenizer does not write.
 */
export const loadFtsTokenizer = (
  db: DatabaseSync,
  extensionRoot: string
): boolean => {
  const dir = dirFor(extensionRoot);
  const library = join(dir, LIBRARY);
  if (!existsSync(library)) return false;

  // The tokenizer reads its character/token filter pipeline from this YAML at load time, and finds
  // it ONLY through the environment. Set it before loading, and leave it set — the extension re-reads
  // it when FTS5 instantiates a tokenizer, not just during init.
  const config = join(dir, "lindera.yml");
  if (existsSync(config)) process.env.LINDERA_CONFIG_PATH = config;

  try {
    db.enableLoadExtension(true);
    // The entry point MUST be named: SQLite otherwise derives `sqlite3_linderasqlite_init` from the
    // filename, which this library does not export ("The specified procedure could not be found").
    //
    // `@types/node` declares `loadExtension(path: string)` with no entry-point parameter, but the
    // runtime accepts one — it maps onto `sqlite3_load_extension`'s third argument, which has taken
    // an entry point since the API was introduced. The cast is that gap, not a behaviour change.
    (db.loadExtension as (path: string, entryPoint?: string) => void)(
      library,
      ENTRY_POINT
    );
    return true;
  } catch {
    // Swallowed deliberately: see the docstring. The caller's fallback is the shipped search path.
    return false;
  } finally {
    // Re-close the door. Extension loading stays off for the rest of the connection's life so a
    // later bug (or a malicious database) cannot use it as a code-execution vector.
    try {
      db.enableLoadExtension(false);
    } catch {
      // Nothing useful to do if even disabling fails.
    }
  }
};
