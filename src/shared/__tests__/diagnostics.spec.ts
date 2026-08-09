import { describe, expect, it } from "vitest";
import {
  diagnosticsMarkdown,
  issueBody,
  issueUrl,
  sanitizeStack,
  URL_BUDGET,
  type Diagnostics
} from "../diagnostics";

/**
 * A real webview stack shape: the script is a `vscode-resource` URL carrying the absolute path the
 * extension was installed to, which on Windows arrives percent-encoded (`c%3A/`).
 */
const WEBVIEW_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'map')",
  "    at WordDetail (https://file+.vscode-resource.vscode-cdn.net/c%3A/Users/drake/.vscode/extensions/saeris.vscode-jisho-1.0.0/dist/webview/index.js:48213:19)",
  "    at renderWithHooks (https://file+.vscode-resource.vscode-cdn.net/c%3A/Users/drake/.vscode/extensions/saeris.vscode-jisho-1.0.0/dist/webview/index.js:11024:26)",
  "    at beginWork (https://file+.vscode-resource.vscode-cdn.net/c%3A/Users/drake/.vscode/extensions/saeris.vscode-jisho-1.0.0/dist/webview/index.js:15331:21)"
].join("\n");

const diagnostics: Diagnostics = {
  environment: [
    { label: "Extension", value: "1.0.0 (abc1234)" },
    { label: "VS Code", value: "1.128.1" }
  ],
  dictionary: [{ label: "Variant", value: "full" }],
  settings: [{ label: "highlighting.enabled", value: "true" }]
};

describe("stack sanitizing", () => {
  it("removes the user's home directory from every frame", () => {
    // WHY: this is the whole reason the sanitizer exists. The report is public and the user is one
    // click from posting it, so a frame carrying `/Users/drake` publishes their account name.
    // Asserted on the OUTPUT rather than per-rule, because what matters is that nothing survives —
    // a rule that stops matching after a Chromium format change would still pass a per-rule test.
    const clean = sanitizeStack(WEBVIEW_STACK);
    expect(clean).not.toContain("drake");
    expect(clean).not.toContain("Users");
    expect(clean).not.toContain("vscode-cdn");
  });

  it("keeps the frame's function, file and position", () => {
    // WHY: sanitizing that destroyed the trace would be safe and useless. The bug is located by
    // function plus line, and both have to survive.
    const clean = sanitizeStack(WEBVIEW_STACK);
    expect(clean).toContain("at WordDetail (webview/index.js:48213:19)");
    expect(clean).toContain(
      "TypeError: Cannot read properties of undefined (reading 'map')"
    );
  });

  it("strips a home directory quoted in the error message itself", () => {
    // WHY: rule 1 only rewrites script URLs. A host-side error often names a path in its MESSAGE —
    // "ENOENT: no such file or directory, open 'C:\\Users\\drake\\...'" — which is line 0 and never
    // a frame, so it would escape a frames-only sanitizer.
    const stack = sanitizeStack(
      "Error: ENOENT, open 'C:\\Users\\drake\\AppData\\jisho.db'\n    at open (host/db.js:12:3)"
    );
    expect(stack).not.toContain("drake");
    expect(stack).toContain("~");
  });

  it("handles a POSIX home directory too", () => {
    const stack = sanitizeStack(
      "Error: bad path /Users/someone/Library/x\n    at f (host/a.js:1:1)"
    );
    expect(stack).not.toContain("someone");
  });

  it("collapses a run of repeated reconciler frames", () => {
    // WHY: React 19's minified stacks are mostly its own internals repeating, and those runs push
    // the app frames that identify the crash past the truncation point. Collapsing before
    // truncating is what keeps the cause inside the URL budget.
    const stack = [
      "Error: boom",
      "    at beginWork (webview/index.js:1:1)",
      "    at beginWork (webview/index.js:1:1)",
      "    at beginWork (webview/index.js:1:1)",
      "    at WordDetail (webview/index.js:2:2)"
    ].join("\n");
    const clean = sanitizeStack(stack);
    expect(clean).toContain("(×3)");
    // The app frame after the run survives, which is the point.
    expect(clean).toContain("at WordDetail");
  });

  it("does not collapse different functions", () => {
    const stack = [
      "Error: boom",
      "    at a (webview/index.js:1:1)",
      "    at b (webview/index.js:2:2)"
    ].join("\n");
    expect(sanitizeStack(stack)).not.toContain("×");
  });

  it("truncates past the frame budget and says how many were dropped", () => {
    const frames = Array.from(
      { length: 40 },
      (_, i) => `    at fn${i} (webview/index.js:${i}:1)`
    );
    const clean = sanitizeStack(["Error: boom", ...frames].join("\n"), 20);
    expect(clean).toContain("… 20 more frames");
    expect(clean.split("\n")).toHaveLength(22); // message + 20 frames + marker
  });
});

describe("issue body", () => {
  it("leads with the user's own description, not the diagnostics", () => {
    // WHY: a body that opens with a wall of environment tables invites the reporter to submit
    // without adding anything — and "what were you doing" is the field a maintainer needs most and
    // can least reconstruct.
    const body = issueBody({ diagnostics });
    expect(body.indexOf("### What happened")).toBeLessThan(
      body.indexOf("Diagnostics")
    );
  });

  it("includes the error and stack only for a crash", () => {
    expect(issueBody({ diagnostics })).not.toContain("### Error");
    const crash = issueBody({
      diagnostics,
      error: { message: "TypeError: x", stack: "    at f (webview/a.js:1:1)" }
    });
    expect(crash).toContain("### Error");
    expect(crash).toContain("at f (webview/a.js:1:1)");
  });

  it("omits a settings section when nothing was changed", () => {
    // WHY: an empty table reads as missing data. No changed settings is information, and the
    // absence of the section says it more clearly than an empty one.
    const md = diagnosticsMarkdown({ ...diagnostics, settings: [] });
    expect(md).not.toContain("Changed settings");
    expect(md).toContain("Environment");
  });
});

describe("issue url", () => {
  const base = "https://github.com/Saeris/vscode-jisho/issues/new";

  it("prefills the body when it fits", () => {
    const { url, overBudget } = issueUrl(base, "Crash", { diagnostics });
    expect(overBudget).toBe(false);
    expect(url).toContain("body=");
    expect(url.length).toBeLessThanOrEqual(URL_BUDGET);
  });

  it("drops the settings diff before it drops the stack", () => {
    // WHY: the trimming ORDER is the design. Settings are the reproduction hint and go first; the
    // stack is the cause and goes last. A trimmer that shortened the stack first would keep noise
    // and discard evidence.
    const many = Array.from({ length: 400 }, (_, i) => ({
      label: `setting${i}`,
      value: "x".repeat(20)
    }));
    const { url, overBudget } = issueUrl(base, "Crash", {
      diagnostics: { ...diagnostics, settings: many },
      error: { message: "TypeError: x", stack: "    at f (webview/a.js:1:1)" }
    });
    expect(overBudget).toBe(false);
    expect(decodeURIComponent(url)).not.toContain("setting399");
    // The stack survived the trim.
    expect(decodeURIComponent(url)).toContain("at f (webview/a.js:1:1)");
  });

  it("falls back to a blank form rather than a report missing its evidence", () => {
    // WHY: the failure this flag prevents is a URL that silently dropped the stack and still looks
    // like a complete report. The caller reads `overBudget` and puts the body on the clipboard.
    const huge = Array.from({ length: 2000 }, (_, i) => ({
      label: `field${i}`,
      value: "y".repeat(40)
    }));
    const { url, overBudget } = issueUrl(base, "Crash", {
      diagnostics: { ...diagnostics, environment: huge }
    });
    expect(overBudget).toBe(true);
    expect(url).not.toContain("body=");
    expect(url.length).toBeLessThanOrEqual(URL_BUDGET);
  });
});
