import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join("/")
    })
  }
}));

const { webviewHtml } = await import("../webviewHtml");

/** The slice of `vscode.Webview` the document builder reads. */
const webview = {
  cspSource: "vscode-webview://abc",
  asWebviewUri: (uri: { fsPath: string }) => ({
    toString: () => `vscode-webview://abc${uri.fsPath}`
  })
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stand-ins
const build = (): string =>
  webviewHtml(webview as any, { fsPath: "/ext" } as any);

const cspOf = (html: string): string =>
  /content="([^"]*)"/u.exec(html)?.[1] ?? "";

describe("webview document", () => {
  it("grants script execution to the nonce the script tag actually carries", () => {
    // WHY: this is the failure that costs an afternoon. If the CSP's nonce and the <script> tag's
    // nonce ever diverge — separate `makeNonce()` calls, a copied line — the browser silently
    // refuses to run the bundle and the sidebar renders as a BLANK panel. There is no error in the
    // extension host, only in a devtools console for a webview nobody thinks to inspect.
    const html = build();
    const cspNonce = /script-src 'nonce-([A-Za-z0-9]+)'/u.exec(
      cspOf(html)
    )?.[1];
    const tagNonce = /<script[^>]*nonce="([A-Za-z0-9]+)"/u.exec(html)?.[1];

    expect(cspNonce).toBeDefined();
    expect(tagNonce).toBe(cspNonce);
  });

  it("issues a different nonce on every build", () => {
    // WHY: the CSP's whole guarantee is that ONE script may run. A nonce that were stable across
    // loads would be guessable from a previous document, which is the attack the mechanism exists
    // to stop — and a constant would still pass the matching test above.
    const nonces = new Set(
      Array.from({ length: 20 }, () => {
        return /script-src 'nonce-([A-Za-z0-9]+)'/u.exec(cspOf(build()))?.[1];
      })
    );
    expect(nonces.size).toBe(20);
  });

  it("denies by default and never allows inline or remote script", () => {
    // WHY: `default-src 'none'` is what makes every other directive an allowlist rather than a
    // relaxation. Losing it, or letting 'unsafe-inline'/https: into script-src, would silently turn
    // the strictest surface in the extension into the most permissive one.
    const csp = cspOf(build());
    expect(csp).toContain("default-src 'none'");
    const scriptSrc = /script-src ([^;]*)/u.exec(csp)?.[1] ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("http");
  });

  it("references its assets through asWebviewUri, not by file path", () => {
    // WHY: a webview cannot load `/ext/dist/webview/index.js` — it has its own origin, and a raw
    // path resolves to nothing. Both assets must go through `asWebviewUri`, and both must be under
    // the `cspSource` the style/font directives allow, or they are fetched and then blocked.
    const html = build();
    expect(html).toContain(
      'src="vscode-webview://abc/ext/dist/webview/index.js"'
    );
    expect(html).toContain(
      'href="vscode-webview://abc/ext/dist/webview/index.css"'
    );
    expect(html).not.toMatch(/(?:src|href)="\/ext/u);
  });
});
