/**
 * Diagnostic log channel ("Jisho").
 *
 * Startup cost is otherwise invisible: the extension does its expensive work lazily (opening a
 * 51MB database, provisioning a 409MB names database, initialising a 12MB tokenizer WASM), and
 * when a first search feels slow there is no way to tell WHICH of those it was waiting on. Every
 * lazy initialisation reports how long it took, so a slow start can be read rather than guessed.
 *
 * Uses a LogOutputChannel: VS Code renders levels and timestamps, and users can raise the level
 * without a setting of ours.
 */
import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

export const log = (): vscode.LogOutputChannel => {
  channel ??= vscode.window.createOutputChannel("Jisho", { log: true });
  return channel;
};

/**
 * Time an async step and log its duration. Returns the step's value, so it wraps a call in place:
 * `const db = await timed("open dictionary", () => Dictionary.open(path))`.
 */
export const timed = async <T>(
  label: string,
  work: () => Promise<T>
): Promise<T> => {
  const started = Date.now();
  try {
    const result = await work();
    log().info(`${label}: ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    // Failures are the most interesting timings — a slow path that then throws is exactly the
    // case worth seeing.
    log().error(
      `${label}: failed after ${Date.now() - started}ms — ${String(err)}`
    );
    throw err;
  }
};
