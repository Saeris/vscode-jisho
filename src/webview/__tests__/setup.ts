/**
 * Component-project setup: stub the webview host API.
 *
 * `bridge.ts` calls `acquireVsCodeApi()` at module load — it exists only inside a real VS Code
 * webview. Any component that transitively imports the bridge (most views do now, for the settings
 * gear and copy-as) would otherwise fail to LOAD under jsdom, before a single assertion runs.
 * Stubbing it here beats repeating a `vi.mock("../../bridge")` in every spec: specs that care
 * about bridge behaviour still mock it explicitly, and the rest just work.
 */
const postedMessages: unknown[] = [];

(globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => postedMessages.push(message)
});
