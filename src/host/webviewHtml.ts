import * as vscode from "vscode";

/**
 * A fresh nonce per document load.
 *
 * The CSP grants script execution to exactly one nonce, so it must be unguessable AND regenerated
 * each time the HTML is built — a static nonce would let any injected `<script nonce="...">` run.
 */
const makeNonce = (): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++)
    nonce += chars[Math.floor(Math.random() * chars.length)];
  return nonce;
};

/**
 * The webview document.
 *
 * A pure function of the webview and the extension's root rather than a method, because it reads no
 * other provider state — and because the CSP is worth being able to assert directly. Its failure
 * mode is silent: a nonce that does not match the script tag, or an asset referenced by file path
 * instead of through `asWebviewUri`, renders a BLANK panel with the reason only in a devtools
 * console nobody has open.
 */
export const webviewHtml = (
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string => {
  const base = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  const script = webview
    .asWebviewUri(vscode.Uri.joinPath(base, "index.js"))
    .toString();
  const style = webview
    .asWebviewUri(vscode.Uri.joinPath(base, "index.css"))
    .toString();
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <title>Jisho</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
};
