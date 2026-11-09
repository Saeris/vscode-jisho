import { describe, expect, it } from "vite-plus/test";
import { SchemaVersionError } from "../db";
import { classifyFailure } from "../failure";

describe("dictionary failure reasons", () => {
  it("tells an older dictionary from a newer one", () => {
    // WHY: they need opposite fixes. An older file is fixed by updating the dictionary; a newer one
    // only by updating Jisho — and the old message sent everyone to the dictionary update, which
    // then said "up to date" to the user it could not help (audit I-2).
    expect(classifyFailure(new SchemaVersionError(6, 5))).toBe("schema-older");
    expect(classifyFailure(new SchemaVersionError(6, 7))).toBe("schema-newer");
  });

  it("recognises a download that never reached the network as offline", () => {
    // WHY: offline is the one failure a retry fixes, so it must not be shown as a bug to report.
    const dns = new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), {
        code: "ENOTFOUND"
      })
    });
    expect(classifyFailure(dns)).toBe("offline");
    expect(classifyFailure(new TypeError("fetch failed"))).toBe("offline");
    expect(
      classifyFailure(
        new Error("Download failed: https://x/y → 503 Service Unavailable")
      )
    ).toBe("offline");
  });

  it("keeps everything else as an I/O problem", () => {
    // WHY: a missing release asset or a locked file is not fixed by waiting, so it must not be
    // dressed up as a network blip.
    expect(
      classifyFailure(new Error("Download failed: https://x/y → 404 Not Found"))
    ).toBe("io");
    expect(classifyFailure(new Error("EBUSY: resource busy or locked"))).toBe(
      "io"
    );
  });
});
