import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadDatabase } from "../download";

// A tiny fake "database" payload, gzipped the same way the data build emits the release asset.
const DB_CONTENT = Buffer.from("fake sqlite database bytes");
const GZ = gzipSync(DB_CONTENT);
const SHA = createHash("sha256").update(GZ).digest("hex");
const VERSION = "full 2026-06-29 2026-07-10T00:00:00.000Z";

const BASE = "https://example.test/release";

/** Stub fetch serving the three release assets; override entries to simulate failures. */
const stubFetch = (overrides: Record<string, Response> = {}): void => {
  vi.stubGlobal("fetch", async (url: string) => {
    const routes: Record<string, () => Response> = {
      [`${BASE}/jisho-full.db.gz.sha256`]: () => new Response(SHA),
      [`${BASE}/jisho-full.db.version`]: () => new Response(VERSION),
      [`${BASE}/jisho-full.db.gz`]: () =>
        new Response(new Uint8Array(GZ), {
          headers: { "content-length": String(GZ.length) }
        })
    };
    const override = overrides[url];
    if (override) return Promise.resolve(override);
    const route = routes[url];
    return Promise.resolve(
      route ? route() : new Response(null, { status: 404 })
    );
  });
};

describe("downloadDatabase", () => {
  let dir: string;
  let dest: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jisho-dl-"));
    dest = join(dir, "jisho.db");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it("downloads, verifies, gunzips, and writes the version sidecar", async () => {
    // WHY: this is the entire installed-user provisioning path — the gunzipped bytes must land
    // at the destination only after the compressed stream's sha256 checks out.
    stubFetch();
    const progress = vi.fn<(received: number, total: number) => void>();
    const version = await downloadDatabase(dest, progress, BASE);

    expect(version).toBe(VERSION);
    await expect(readFile(dest)).resolves.toEqual(DB_CONTENT);
    await expect(readFile(`${dest}.version`, "utf8")).resolves.toBe(VERSION);
    // Progress saw the full byte count.
    expect(progress).toHaveBeenCalledWith(GZ.length, GZ.length);
  });

  it("rejects on checksum mismatch and leaves no partial file", async () => {
    // WHY: a corrupted or truncated download must never masquerade as a valid dictionary — and
    // the .part temp file must not linger to confuse the next attempt.
    stubFetch({
      [`${BASE}/jisho-full.db.gz.sha256`]: new Response("0".repeat(64))
    });
    await expect(downloadDatabase(dest, () => {}, BASE)).rejects.toThrow(
      /checksum mismatch/
    );
    await expect(stat(dest)).rejects.toThrow();
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });

  it("rejects with a useful error on a missing asset", async () => {
    // WHY: if the data release doesn't exist yet (or the URL rots), the error must say what
    // failed rather than surfacing a cryptic stream error.
    stubFetch({
      [`${BASE}/jisho-full.db.gz.sha256`]: new Response(null, { status: 404 })
    });
    await expect(downloadDatabase(dest, () => {}, BASE)).rejects.toThrow(
      /Download failed/
    );
  });
});
