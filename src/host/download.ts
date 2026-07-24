/**
 * Dictionary download: fetch the zstd-compressed database from the rolling `dictionary-latest` GitHub
 * Release, verify its sha256, and decompress it into place. Pure Node (fetch/zlib/fs) so it is
 * unit-testable without the vscode API — `ensureDatabase` wraps it in the progress UI. Node 26 ships
 * zstd in node:zlib, matching the build's `.zst` output — no runtime dependency.
 */
import { createWriteStream } from "node:fs";
import { rename, rm, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createZstdDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

/** Rolling data release; decoupled from extension releases so dictionary refreshes are cheap. */
export const DATA_RELEASE_BASE =
  "https://github.com/Saeris/vscode-jisho/releases/download/dictionary-latest";

export interface DownloadProgress {
  /** Bytes received so far and the total (from Content-Length; 0 when unknown). */
  (received: number, total: number): void;
}

const fetchOk = async (url: string): Promise<Response> => {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || res.body === null) {
    throw new Error(
      `Download failed: ${url} → ${res.status} ${res.statusText}`
    );
  }
  return res;
};

/**
 * Download `<base>/<prefix>.zst`, verify it against `<base>/<prefix>.zst.sha256`, and decompress it
 * to `destPath` (written via a `.part` temp file, renamed only after verification). Returns the
 * release's version string (from `<base>/<prefix>.zst.version`) for the sidecar. `prefix` selects the
 * artifact — `jisho-full.db` (the word DB) or `jisho-names.db` (the optional names DB).
 */
export const downloadDatabase = async (
  destPath: string,
  onProgress: DownloadProgress,
  base: string = DATA_RELEASE_BASE,
  prefix = "jisho-full.db"
): Promise<string> => {
  const expectedSha = (
    await (await fetchOk(`${base}/${prefix}.zst.sha256`)).text()
  ).trim();
  const version = (
    await (await fetchOk(`${base}/${prefix}.zst.version`)).text()
  ).trim();

  const res = await fetchOk(`${base}/${prefix}.zst`);
  // fetchOk already rejected null bodies, but the Response type can't carry that narrowing.
  const body = res.body;
  if (body === null) throw new Error("Download failed: empty response body");
  const total = Number(res.headers.get("content-length") ?? 0);
  const hash = createHash("sha256");
  let received = 0;

  // Hash the compressed bytes as they stream past, then decompress into the temp file.
  const hashTap = new Transform({
    transform(chunk: Buffer, _enc, done): void {
      hash.update(chunk);
      received += chunk.length;
      onProgress(received, total);
      done(null, chunk);
    }
  });

  const tempPath = `${destPath}.part`;
  try {
    // Readable.from accepts any async iterable — including the fetch body's web ReadableStream —
    // which sidesteps the DOM-vs-node stream type mismatch that Readable.fromWeb trips over.
    await pipeline(
      Readable.from(body),
      hashTap,
      createZstdDecompress(),
      createWriteStream(tempPath)
    );
    const actualSha = hash.digest("hex");
    if (actualSha !== expectedSha) {
      throw new Error(
        `Dictionary checksum mismatch (expected ${expectedSha.slice(0, 12)}…, got ${actualSha.slice(0, 12)}…) — try again later.`
      );
    }
    await rename(tempPath, destPath);
    await writeFile(`${destPath}.version`, version, "utf8");
    return version;
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }
};

/** Read a previously-written version sidecar, or undefined when absent. */
export const readVersionSidecar = async (
  dbPath: string
): Promise<string | undefined> => {
  try {
    return (await readFile(`${dbPath}.version`, "utf8")).trim();
  } catch {
    return undefined;
  }
};
