/**
 * What `openExternal` actually receives.
 *
 * The prefilled body is percent-encoded by `issueUrl`, and that encoding has to survive all the way
 * to the browser. It did not: 0.1.2 shipped `openExternal(Uri.parse(url))`, and every report opened
 * with a literal `%23%23%23` where its `###` headings belonged (issue #4).
 *
 * The mock's `Uri.parse` therefore reproduces the REAL behaviour rather than echoing its input — a
 * stub that returned the string unchanged would pass whether or not the bug is present, which is
 * the failure mode that let this ship in the first place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const opened: unknown[] = [];

/**
 * `vscode.Uri`, faithful on the one axis this test turns on.
 *
 * `parse` DECODES the query into the component (so `%23` becomes a raw `#`), and `toString`
 * re-encodes it per character. Both halves are needed: it is the round trip, not either step, that
 * corrupts the body.
 */
const parse = (value: string): { toString: () => string } => {
  const [head, ...rest] = value.split("?");
  const query = decodeURIComponent(rest.join("?"));
  return {
    toString: () =>
      query === ""
        ? head
        : // Everything outside RFC 3986's unreserved set is escaped, `=` and `&` included.
          `${head}?${query.replace(/[^\w.~-]/gu, (c) => encodeURIComponent(c))}`
  };
};

// Plain functions rather than `vi.fn`: nothing here is asserted on as a spy — what the report is
// judged by is the URL string it hands to `openExternal`, which `opened` records.
vi.mock("vscode", () => ({
  Uri: { parse },
  env: {
    clipboard: { writeText: async (): Promise<void> => undefined },
    openExternal: async (target: unknown): Promise<boolean> => {
      opened.push(target);
      return true;
    }
  },
  window: {
    showInformationMessage: async (): Promise<undefined> => undefined,
    showErrorMessage: async (): Promise<undefined> => undefined
  },
  workspace: {
    getConfiguration: () => ({
      get: (_k: string, fallback: unknown) => fallback
    })
  },
  extensions: { getExtension: () => undefined },
  version: "1.132.0"
}));

vi.mock("../diagnostics", () => ({
  collectDiagnostics: async () => ({
    environment: [{ label: "Extension", value: "0.1.3" }],
    dictionary: [],
    settings: []
  })
}));

const { openIssueReport } = await import("../report");

const context = {} as never;

/** The `body` parameter as GitHub would read it: split the query, then decode once. */
const bodyParam = (target: unknown): string | null => {
  const url = String(target);
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("body");
};

describe("issue report url", () => {
  beforeEach(() => {
    opened.length = 0;
  });

  it("delivers the body with its Markdown headings intact", async () => {
    // WHY: this is the whole point of prefilling. A body whose `###` arrives as the literal text
    // `%23%23%23` is not a formatting nit — the template stops being a template, and the reporter
    // has to work around it by hand, which is exactly what the reporter of #4 did.
    await openIssueReport(context, { title: "Crash" });

    expect(opened).toHaveLength(1);
    const body = bodyParam(opened[0]);
    expect(body).toContain("### What happened");
    expect(body).toContain("### Steps to reproduce");
    expect(body).not.toContain("%23");
  });

  it("passes a string, so nothing re-encodes what issueUrl already encoded", async () => {
    // WHY: the mechanism, pinned separately from the symptom above. `openExternal` keeps a string
    // verbatim but rebuilds a `Uri` from its decoded components, so handing it a `Uri` is what
    // corrupts the query. Someone "tidying" this back into `Uri.parse(url)` reintroduces #4, and
    // the assertion above alone would not say why.
    await openIssueReport(context, { title: "Crash" });

    expect(typeof opened[0]).toBe("string");
  });

  it("still names the repository the report belongs to", async () => {
    // WHY: cheap, and the string path has no parser validating it. A malformed URL would open
    // *something* and fail silently.
    await openIssueReport(context, { title: "Crash" });

    expect(String(opened[0])).toContain(
      "https://github.com/Saeris/vscode-jisho/issues/new"
    );
  });
});
