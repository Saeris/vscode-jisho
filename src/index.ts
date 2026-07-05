import * as vscode from "vscode";

/**
 * Called by VSCode when the extension is activated. Because `activationEvents`
 * is empty, activation is driven by the contributed commands declared in
 * package.json — the first time a command runs, this function is invoked.
 */
export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    "vscode-extension-template.helloWorld",
    () => {
      void vscode.window.showInformationMessage("Hello World!");
    }
  );

  // Disposables registered here are cleaned up automatically on deactivate.
  context.subscriptions.push(command);
}

/** Called by VSCode when the extension is deactivated. */
export function deactivate(): void {}
